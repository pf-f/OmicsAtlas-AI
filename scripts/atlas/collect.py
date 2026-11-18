"""Incremental collection with durable cursors and explicit failure semantics."""

import copy
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from .classify import ROOT, RULE_VERSION, TAXONOMY, classify, extract_links
from .github import AuthenticationError, BudgetExhausted, Client, RemoteError
from .store import (
    atomic_json,
    compact_metadata,
    load_state,
    make_catalog,
    observe,
    utcnow,
)


def source(kind, url):
    return {"kind": kind, "url": url}


def add_pending(state, name, origin, metadata=None):
    key = name.lower()
    known = next(
        (
            r
            for r in state["records"].values()
            if r["metadata"]["full_name"].lower() == key
        ),
        None,
    )
    if known:
        if origin not in known.setdefault("sources", []) and len(known["sources"]) < 6:
            known["sources"].append(origin)
        return known
    item = state["pending"].setdefault(key, {"full_name": name, "sources": []})
    if origin not in item["sources"] and len(item["sources"]) < 6:
        item["sources"].append(origin)
    if metadata:
        item["metadata"] = compact_metadata(metadata)
        item["metadata_at"] = utcnow()
    return None


def load_candidates(state):
    for item in json.loads((ROOT / "config/seeds.json").read_text()):
        add_pending(state, item["full_name"], source("seed", item["source_url"]))
    legacy = ROOT / "data/legacy/ranking_report.json"
    if legacy.exists():
        for category in json.loads(legacy.read_text()).get("categories", {}).values():
            for r in category.get("top_20_pipelines", []) + category.get(
                "top_10_utilities", []
            ):
                add_pending(state, r["full_name"], source("legacy-candidate", r["url"]))


def discovery_queries():
    since = (datetime.now(timezone.utc) - timedelta(days=180)).date().isoformat()
    queries = []
    for d in TAXONOMY["domains"]:
        queries.append((f"topic:{d['topics'][0]} fork:false", "stars", d["id"]))
        queries.append(
            (
                f'"{d["phrases"][0]}" in:name,description,readme fork:false created:>={since}',
                "updated",
                d["id"],
            )
        )
    return queries


def collect(args, client=None):
    data_dir, output_dir = Path(args.data_dir), Path(args.output_dir)
    state_path = data_dir / "state.json"
    state = load_state(state_path)
    before = copy.deepcopy(state)
    load_candidates(state)
    client = client or Client(args.request_budget, ROOT / ".cache/http")
    repository_url = (
        os.getenv("GITHUB_SERVER_URL", "https://github.com")
        + "/"
        + os.getenv("GITHUB_REPOSITORY", "pf-f/OmicsAtlas-AI")
    )
    run_url = (
        repository_url
        + "/actions"
        + ("/runs/" + os.environ["GITHUB_RUN_ID"] if os.getenv("GITHUB_RUN_ID") else "")
    )
    run = {
        "started_at": utcnow(),
        "finished_at": None,
        "status": "ok",
        "requests": 0,
        "queries_completed": 0,
        "queries_capped": 0,
        "refreshed": 0,
        "checked": 0,
        "errors": [],
        "budget_limited": False,
        "url": run_url,
    }
    fresh_ids = set()
    try:
        existing = sorted(
            state["records"].items(), key=lambda pair: pair[1].get("observed_at", "")
        )
        existing = [
            (rid, r)
            for rid, r in existing
            if r.get("classification", {}).get("decision") == "accepted"
        ][: args.refresh_limit]
        for rid, record in existing:
            try:
                repo = client.repository(record["metadata"]["full_name"])
                if repo is None:
                    record["unavailable"] = True
                    continue
                changed = any(
                    repo.get(k) != record["metadata"].get(k)
                    for k in ["pushed_at", "description", "topics", "name"]
                )
                observe(record, repo, utcnow())
                record["unavailable"] = False
                fresh_ids.add(str(repo["id"]))
                run["refreshed"] += 1
                if changed or record["classification"]["rule_version"] != RULE_VERSION:
                    record["needs_enrichment"] = True
            except (AuthenticationError, BudgetExhausted):
                raise
            except RemoteError as exc:
                run["errors"].append(str(exc))
        if (
            existing
            and not run["refreshed"]
            and not any(r.get("unavailable") for _, r in existing)
        ):
            raise RemoteError("All required repository refreshes failed")
        queries = discovery_queries()
        for _ in range(min(args.query_limit, len(queries))):
            cursor = state.get("discovery_cursor", 0) % len(queries)
            query, sort, domain = queries[cursor]
            try:
                for page in range(1, args.pages + 1):
                    response = client.search(query, sort, page)
                    if response.get("incomplete_results"):
                        run["errors"].append(f"Incomplete search response: {query}")
                    if (
                        page == args.pages
                        and response.get("total_count", 0) > args.pages * 100
                    ):
                        run["queries_capped"] += 1
                    for repo in response.get("items", []):
                        origin = source(
                            "github-search",
                            "https://github.com/search?type=repositories&q="
                            + quote(query),
                        )
                        known = add_pending(state, repo["full_name"], origin, repo)
                        if known:
                            changed = any(
                                repo.get(k) != known["metadata"].get(k)
                                for k in ["pushed_at", "description", "topics", "name"]
                            )
                            observe(known, repo, utcnow())
                            fresh_ids.add(str(repo["id"]))
                            if (
                                changed
                                or known.get("classification", {}).get("rule_version")
                                != RULE_VERSION
                            ):
                                known["needs_enrichment"] = True
                        else:
                            state["pending"][repo["full_name"].lower()][
                                "domain_hint"
                            ] = domain
                    if len(response.get("items", [])) < 100:
                        break
                run["queries_completed"] += 1
                state["discovery_cursor"] = (cursor + 1) % len(queries)
            except (AuthenticationError, BudgetExhausted):
                raise
            except RemoteError as exc:
                run["errors"].append(str(exc))
                state["discovery_cursor"] = (cursor + 1) % len(queries)
        if args.query_limit and not run["queries_completed"]:
            raise RemoteError("No discovery query succeeded; previous catalog retained")
        if args.registry:
            terms = [d["en"] for d in TAXONOMY["domains"]]
            index = state.get("registry_cursor", 0) % len(terms)
            try:
                body = client.get(
                    "https://bio.tools/api/tool/",
                    {"format": "json", "q": terms[index], "page": 1},
                )
                for entry in body.get("list", []):
                    for link in entry.get("link", []):
                        m = re.fullmatch(
                            r"https?://github\.com/([^/]+/[^/#?]+?)(?:\.git)?/?",
                            link.get("url", ""),
                        )
                        if m:
                            add_pending(
                                state,
                                m[1],
                                source(
                                    "bio.tools",
                                    "https://bio.tools/" + entry["biotoolsID"],
                                ),
                            )
                state["registry_cursor"] = (index + 1) % len(terms)
            except (AuthenticationError, BudgetExhausted):
                raise
            except RemoteError as exc:
                run["errors"].append(str(exc))
        for record in state["records"].values():
            if record.get("classification", {}).get("rule_version") != RULE_VERSION:
                record["needs_enrichment"] = True
        work = [
            (rid, r, False)
            for rid, r in state["records"].items()
            if r.get("needs_enrichment")
        ]
        seed_names = {
            s["full_name"].lower()
            for s in json.loads((ROOT / "config/seeds.json").read_text())
        }
        seeds, groups = [], {}
        for key, item in state["pending"].items():
            if key in seed_names:
                seeds.append((key, item, True))
            else:
                groups.setdefault(item.get("domain_hint", "legacy"), []).append(
                    (key, item, True)
                )
        work.extend(seeds)
        while any(groups.values()):
            for group in groups.values():
                if group:
                    work.append(group.pop(0))
        for key, item, is_pending in work[: args.enrich_limit]:
            try:
                repo = item.get("metadata")
                fetched_metadata = repo is None
                if repo is None:
                    repo = client.repository(
                        item.get("full_name") or item["metadata"]["full_name"]
                    )
                if repo is None:
                    item["last_error"] = "repository-not-found"
                    continue
                readme = client.readme(repo)
                decision = classify(repo, readme)
                files = []
                if (
                    decision["decision"] == "review"
                    and decision["domains"]
                    and not decision["software_evidence"]
                ):
                    files = client.software_files(repo)
                    decision = classify(repo, readme, files)
                rid = str(repo["id"])
                record = state["records"].setdefault(
                    rid, {"sources": item.get("sources", [])[:]}
                )
                observed_at = (
                    utcnow()
                    if fetched_metadata
                    else item.get("metadata_at")
                    or record.get("observed_at")
                    or utcnow()
                )
                observe(record, repo, observed_at)
                if fetched_metadata or item.get("metadata_at"):
                    fresh_ids.add(rid)
                record.update(
                    classification=decision,
                    links=extract_links(repo, readme, files),
                    evidence_checked_at=utcnow(),
                    needs_enrichment=False,
                )
                for origin in item.get("sources", []):
                    if origin not in record["sources"]:
                        record["sources"].append(origin)
                run["checked"] += 1
                print(
                    f"{decision['decision']:8} {repo['full_name']} {','.join(decision['domains'])}",
                    flush=True,
                )
                if is_pending:
                    state["pending"].pop(key, None)
            except (AuthenticationError, BudgetExhausted):
                raise
            except RemoteError as exc:
                run["errors"].append(str(exc))
    except BudgetExhausted as exc:
        run["budget_limited"] = True
        run["budget_note"] = str(exc)
    except (AuthenticationError, RemoteError):
        atomic_json(ROOT / ".cache/failed-state.json", state)
        raise
    run["finished_at"] = utcnow()
    run["requests"] = client.requests
    run["observed_repositories"] = len(fresh_ids)
    run["status"] = (
        "partial"
        if run["errors"]
        else "incremental"
        if run["budget_limited"] or state["pending"]
        else "ok"
    )
    catalog = make_catalog(state, run)
    if not catalog["repositories"]:
        atomic_json(ROOT / ".cache/pending-state.json", state)
        raise RemoteError("No tools passed verification; previous catalog retained")
    if not (run["checked"] or run["refreshed"] or fresh_ids):
        atomic_json(ROOT / ".cache/pending-state.json", state)
        raise RemoteError(
            "No repository observations completed; previous catalog retained"
        )
    state["runs"] = (before.get("runs", []) + [run])[-52:]
    atomic_json(state_path, state)
    atomic_json(output_dir / "catalog.json", catalog)
    atomic_json(data_dir / "runs.json", state["runs"])
    print(
        json.dumps({"counts": catalog["counts"], "run": run}, ensure_ascii=False),
        flush=True,
    )
    return catalog
