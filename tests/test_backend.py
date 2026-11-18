import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from atlas.classify import classify, extract_links, TAXONOMY, safe_url
from atlas.github import Client, RemoteError, BudgetExhausted, AuthenticationError
from atlas.store import (
    observe,
    growth,
    make_catalog,
    validate_catalog,
    atomic_json,
    load_state,
)
from atlas.collect import collect, add_pending, discovery_queries


def repository(**values):
    return {
        "id": 123,
        "name": "atlas-test",
        "full_name": "lab/atlas-test",
        "html_url": "https://github.com/lab/atlas-test",
        "description": "Python package for single-cell analysis",
        "topics": [],
        "language": "Python",
        "default_branch": "main",
        "stargazers_count": 100,
        "forks_count": 2,
        "created_at": "2025-01-01T00:00:00Z",
        "pushed_at": "2026-11-01T00:00:00Z",
        **values,
    }


README = "# atlas-test\nA Python package for single-cell analysis.\n## Installation\n```bash\npip install atlas-test==1.2\n```\n"
RUN = {"finished_at": "2026-11-01T00:00:00Z", "status": "ok"}


def record():
    r = {
        "classification": classify(repository(), README),
        "links": extract_links(repository(), README),
        "sources": [],
    }
    observe(r, repository(), "2026-11-01T00:00:00Z")
    return r


class ClassificationTests(unittest.TestCase):
    def test_all_domains_have_positive_path(self):
        for d in TAXONOMY["domains"]:
            with self.subTest(domain=d["id"]):
                r = repository(description="A Python package for " + d["phrases"][0])
                c = classify(r, README)
                self.assertEqual(c["decision"], "accepted")
                self.assertIn(d["id"], c["domains"])

    def test_acronym_and_generic_negatives(self):
        for name, text in [
            ("webpack", "A fast ESM bundler"),
            ("universal", "Generic universal image viewer"),
            ("mil", "Multiple instance learning for satellite images"),
            ("seatunnel", "A multimodal data integration engine"),
            ("xenium", "Concurrent data structures and memory reclamation"),
        ]:
            with self.subTest(name=name):
                c = classify(
                    repository(name=name, description=text),
                    "# Project\n"
                    + text
                    + "\n## Installation\n```sh\npip install tool\n```",
                )
                self.assertNotEqual(c["decision"], "accepted")

    def test_learning_not_excluded(self):
        self.assertEqual(
            classify(
                repository(
                    description="Deep learning framework for single-cell analysis"
                ),
                README,
            )["decision"],
            "accepted",
        )

    def test_readme_only_and_multiple_domains(self):
        c = classify(
            repository(description="A Python package"),
            README.replace(
                "single-cell analysis",
                "single-cell and spatial transcriptomics analysis",
            ),
        )
        self.assertEqual(c["decision"], "accepted")
        self.assertIn("single-cell", c["domains"])
        self.assertIn("spatial-omics", c["domains"])

    def test_reference_and_code_mentions_are_not_domains(self):
        for section in [
            "## References\nSingle-cell analysis",
            "## Usage\n```python\n# single-cell analysis\n```",
        ]:
            self.assertNotEqual(
                classify(
                    repository(description="A Python package"),
                    "# Tool\nA generic program.\n" + section,
                )["decision"],
                "accepted",
            )

    def test_domain_without_software_waits_for_review(self):
        self.assertEqual(
            classify(repository(), "A research proposal for single-cell analysis")[
                "decision"
            ],
            "review",
        )

    def test_ci_file_is_not_analysis_pipeline(self):
        c = classify(repository(), README, [".github/workflows/ci.yml"])
        self.assertNotIn("pipeline", c["tool_types"])
        self.assertIn(
            "pipeline", classify(repository(), README, ["main.nf"])["tool_types"]
        )

    def test_resource_collections_not_admitted(self):
        for text in [
            "A curated list of single-cell tools",
            "Agent skills library for genomics",
            "A computational curriculum for genomics",
        ]:
            self.assertEqual(
                classify(repository(description=text), README)["decision"], "rejected"
            )

    def test_badges_not_domains(self):
        c = classify(
            repository(description="An image viewer"),
            "# Tool\n![single-cell](https://badge.example)\n## Installation\n```sh\npip install viewer\n```",
        )
        self.assertEqual(c["domains"], [])

    def test_mass_spectrometry_not_automatically_proteomics(self):
        c = classify(
            repository(description="Mass spectrometry data processing"),
            README.replace("single-cell analysis", "mass spectrometry processing"),
        )
        self.assertNotIn("proteomics", c["domains"])

    def test_install_excerpt_preserves_version_and_editable_flags(self):
        text = "```sh\npip install sample==1.2\npip install -e .[gpu]\n```"
        installs = extract_links(repository(), text)["install"]
        self.assertEqual(
            installs[0]["command"], "pip install sample==1.2\npip install -e .[gpu]"
        )

    def test_environment_not_inferred_from_container_word(self):
        self.assertEqual(
            extract_links(repository(), "A container for cells")["environments"], []
        )
        self.assertEqual(
            extract_links(repository(), "docker run tool")["environments"][0]["id"],
            "docker",
        )

    def test_paper_is_a_link_not_a_count(self):
        d = extract_links(
            repository(),
            "Citations: https://doi.org/10.1000/test. https://pubmed.ncbi.nlm.nih.gov/1234/",
        )
        self.assertEqual(len(d["papers"]), 2)
        self.assertNotIn("citations", d)

    def test_links_reject_script_and_credentials(self):
        for url in [
            "javascript:alert(1)",
            "https://token@github.com/lab/repo",
            "file:///tmp/test",
        ]:
            self.assertFalse(safe_url(url))


class ObservationTests(unittest.TestCase):
    def test_first_baseline_is_null(self):
        self.assertIsNone(growth(record())["delta"])

    def test_weekly_and_negative_growth(self):
        r = record()
        observe(r, repository(stargazers_count=90), "2026-11-08T00:00:00Z")
        self.assertEqual(growth(r)["weekly_delta"], -10)

    def test_two_week_gap_not_weekly(self):
        r = record()
        observe(r, repository(stargazers_count=110), "2026-11-15T00:00:00Z")
        self.assertEqual(growth(r)["delta"], 10)
        self.assertIsNone(growth(r)["weekly_delta"])

    def test_same_date_and_rename_preserve_identity(self):
        r = record()
        observe(
            r,
            repository(full_name="new/renamed", stargazers_count=105),
            "2026-11-01T12:00:00Z",
        )
        self.assertEqual(len(r["snapshots"]), 1)
        self.assertEqual(r["first_seen_at"], "2026-11-01T00:00:00Z")
        self.assertIsNone(growth(r)["delta"])

    def test_no_repeated_intraday_growth_and_bounded_history(self):
        r = record()
        from datetime import datetime, timedelta, timezone

        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        r["snapshots"] = []
        for i in range(400):
            observe(
                r,
                repository(stargazers_count=i),
                (start + timedelta(days=i)).isoformat(),
            )
        self.assertLessEqual(len(r["snapshots"]), 66)

    def test_bootstrap_and_sunday_in_same_iso_week(self):
        r = {}
        observe(r, repository(stargazers_count=100), "2026-11-16T00:00:00Z")
        observe(r, repository(stargazers_count=112), "2026-11-22T00:00:00Z")
        self.assertEqual(growth(r)["weekly_delta"], 12)

    def test_timezone_offsets_and_stale_samples(self):
        r = {}
        observe(r, repository(stargazers_count=100), "2026-11-01T08:00:00+08:00")
        observe(r, repository(stargazers_count=110), "2026-11-08T00:00:00Z")
        self.assertEqual(growth(r)["days"], 7)
        observe(r, repository(stargazers_count=80), "2026-11-02T00:00:00Z")
        self.assertEqual(r["metadata"]["stargazers_count"], 110)

    def test_full_catalog_deduplicated_counts(self):
        r = record()
        r["classification"]["domains"].append("transcriptomics")
        c = make_catalog({"records": {"123": r}, "pending": {}}, RUN)
        self.assertEqual(c["counts"]["accepted"], 1)
        self.assertEqual(c["counts"]["domains"]["single-cell"], 1)
        self.assertEqual(c["counts"]["domains"]["transcriptomics"], 1)

    def test_invalid_catalog_and_evidence_fail(self):
        c = make_catalog({"records": {"123": record()}, "pending": {}}, RUN)
        c["repositories"][0]["classification"]["evidence"] = []
        with self.assertRaises(ValueError):
            validate_catalog(c)

    def test_atomic_state_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "state.json"
            s = load_state(p)
            atomic_json(p, s)
            self.assertEqual(load_state(p), s)


class HTTPTests(unittest.TestCase):
    def response(self, status=200, body=None, headers=None):
        r = Mock(
            status_code=status,
            headers=headers or {},
            ok=200 <= status < 300,
            text=json.dumps(body or {}),
        )
        r.json.return_value = body or {}
        return r

    def test_auth_error_not_retried(self):
        c = Client(token="private")
        c.session.get = Mock(return_value=self.response(401))
        with self.assertRaises(AuthenticationError):
            c.repository("lab/tool")
        self.assertEqual(c.session.get.call_count, 1)

    def test_credentials_only_go_to_github_api(self):
        c = Client(token="private")
        c.session.get = Mock(return_value=self.response())
        c.get("https://raw.githubusercontent.com/lab/tool/main/README.md", text=True)
        self.assertNotIn("Authorization", c.session.get.call_args.kwargs["headers"])
        c.repository("lab/tool")
        self.assertIn("Authorization", c.session.get.call_args.kwargs["headers"])

    def test_rate_limit_stops_and_access_error_is_not_rate_limit(self):
        c = Client()
        c.session.get = Mock(
            return_value=self.response(403, headers={"X-RateLimit-Remaining": "0"})
        )
        with self.assertRaises(BudgetExhausted):
            c.repository("lab/tool")
        c = Client()
        c.session.get = Mock(return_value=self.response(403))
        with self.assertRaises(RemoteError) as e:
            c.repository("lab/tool")
        self.assertNotIsInstance(e.exception, BudgetExhausted)

    def test_retries_bounded(self):
        c = Client()
        c.session.get = Mock(return_value=self.response(500))
        with patch("atlas.github.time.sleep"), self.assertRaises(RemoteError):
            c.repository("lab/tool")
        self.assertEqual(c.session.get.call_count, 3)

    def test_readme_missing_is_not_read_failure(self):
        c = Client()
        c.session.get = Mock(return_value=self.response(404))
        self.assertIsNone(c.repository("lab/deleted"))
        c.session.get = Mock(return_value=self.response(500))
        with patch("atlas.github.time.sleep"), self.assertRaises(RemoteError):
            c.readme(repository())

    def test_304_keeps_cached_content(self):
        with tempfile.TemporaryDirectory() as d:
            c = Client(cache_dir=d)
            c.session.get = Mock(
                side_effect=[
                    self.response(body={"id": 1}, headers={"ETag": "hash"}),
                    self.response(304),
                ]
            )
            self.assertEqual(c.repository("lab/tool"), {"id": 1})
            self.assertEqual(c.repository("lab/tool"), {"id": 1})
            self.assertEqual(
                c.session.get.call_args.kwargs["headers"]["If-None-Match"], "hash"
            )

    def test_budget_counts_retries(self):
        c = Client(budget=1)
        c.session.get = Mock(return_value=self.response(500))
        with patch("atlas.github.time.sleep"), self.assertRaises(BudgetExhausted):
            c.repository("lab/tool")
        self.assertEqual(c.requests, 1)


class CollectorTests(unittest.TestCase):
    def setup_dir(self, d):
        root = Path(d)
        (root / "config").mkdir()
        (root / "config/seeds.json").write_text("[]")
        state = {
            "schema_version": 1,
            "records": {"123": record()},
            "pending": {},
            "runs": [],
        }
        atomic_json(root / "data/state.json", state)
        return root, SimpleNamespace(
            data_dir=str(root / "data"),
            output_dir=str(root / "site"),
            request_budget=10,
            query_limit=0,
            pages=2,
            refresh_limit=2,
            enrich_limit=2,
            registry=False,
        )

    def test_full_failure_leaves_state_and_public_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            root, args = self.setup_dir(d)
            before = (root / "data/state.json").read_bytes()
            c = Mock(requests=1)
            c.repository.side_effect = RemoteError("offline")
            with (
                patch("atlas.collect.ROOT", root),
                patch("atlas.collect.load_candidates"),
                self.assertRaises(RemoteError),
            ):
                collect(args, c)
            self.assertEqual((root / "data/state.json").read_bytes(), before)
            self.assertFalse((root / "site/catalog.json").exists())

    def test_transient_single_failure_retains_record(self):
        with tempfile.TemporaryDirectory() as d:
            root, args = self.setup_dir(d)
            s = load_state(root / "data/state.json")
            r = record()
            observe(
                r, repository(id=456, full_name="lab/second"), "2026-11-01T00:00:00Z"
            )
            s["records"]["456"] = r
            atomic_json(root / "data/state.json", s)
            c = Mock(requests=2)
            c.repository.side_effect = [
                RemoteError("offline"),
                repository(id=456, full_name="lab/second"),
            ]
            with (
                patch("atlas.collect.ROOT", root),
                patch("atlas.collect.load_candidates"),
            ):
                out = collect(args, c)
            self.assertEqual(out["counts"]["accepted"], 2)
            self.assertEqual(out["run"]["status"], "partial")
            self.assertEqual(
                next(r for r in out["repositories"] if r["id"] == 123)["observed_at"],
                "2026-11-01T00:00:00Z",
            )

    def test_pagination_respects_configured_pages(self):
        with tempfile.TemporaryDirectory() as d:
            root, args = self.setup_dir(d)
            args.query_limit = 1
            args.refresh_limit = 0
            args.enrich_limit = 0
            c = Mock(requests=2)
            c.search.return_value = {"items": [repository()] * 100, "total_count": 500}
            with (
                patch("atlas.collect.ROOT", root),
                patch("atlas.collect.load_candidates"),
            ):
                out = collect(args, c)
            self.assertEqual(c.search.call_count, 2)
            self.assertEqual(out["run"]["queries_capped"], 1)

    def test_search_absence_does_not_delete(self):
        with tempfile.TemporaryDirectory() as d:
            root, args = self.setup_dir(d)
            args.query_limit = 1
            c = Mock(requests=2)
            c.repository.return_value = repository()
            c.search.return_value = {"items": [], "total_count": 0}
            with (
                patch("atlas.collect.ROOT", root),
                patch("atlas.collect.load_candidates"),
            ):
                out = collect(args, c)
            self.assertEqual(out["counts"]["accepted"], 1)

    def test_stable_id_merges_renamed_candidates(self):
        s = {"records": {}, "pending": {}}
        add_pending(
            s, "Lab/Tool", {"kind": "seed", "url": "https://github.com/Lab/Tool"}
        )
        add_pending(
            s, "lab/tool", {"kind": "search", "url": "https://github.com/Lab/Tool"}
        )
        self.assertEqual(len(s["pending"]), 1)

    def test_queries_unique(self):
        q = discovery_queries()
        self.assertEqual(len(q), len(set(q)))
        self.assertEqual(len(q), 22)


if __name__ == "__main__":
    unittest.main()
