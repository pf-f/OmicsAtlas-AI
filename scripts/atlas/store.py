"""Durable observations and a validated, complete public snapshot."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path

from .classify import TAXONOMY


def utcnow():
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (
        parsed.astimezone(timezone.utc)
        if parsed.tzinfo
        else parsed.replace(tzinfo=timezone.utc)
    )


def load_state(path):
    if not Path(path).exists():
        return {
            "schema_version": 1,
            "records": {},
            "pending": {},
            "discovery_cursor": 0,
            "runs": [],
        }
    state = json.loads(Path(path).read_text())
    if state.get("schema_version") != 1 or not isinstance(state.get("records"), dict):
        raise ValueError("Unsupported state format")
    return state


def atomic_json(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as output:
        json.dump(body, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temp.replace(path)


def compact_metadata(repo):
    return {
        key: repo.get(key)
        for key in [
            "id",
            "name",
            "full_name",
            "html_url",
            "description",
            "topics",
            "language",
            "license",
            "homepage",
            "stargazers_count",
            "forks_count",
            "open_issues_count",
            "created_at",
            "pushed_at",
            "archived",
            "disabled",
            "default_branch",
        ]
    }


def observe(record, repo, at):
    if record.get("observed_at") and parse_time(at) < parse_time(record["observed_at"]):
        return
    record["metadata"] = compact_metadata(repo)
    record.setdefault("first_seen_at", at)
    record["observed_at"] = at
    points = record.setdefault("snapshots", [])
    sample = {"at": at, "stars": repo.get("stargazers_count", 0)}
    # Same UTC date is a replacement, so retries cannot create fake growth.
    if points and points[-1]["at"][:10] == at[:10]:
        points[-1] = sample
    else:
        points.append(sample)
    # Keep recent daily observations so a Monday bootstrap and Sunday update
    # retain their valid six-day baseline even within the same ISO week.
    # Compact older samples weekly, retaining roughly a year in bounded space.
    by_week = {}
    recent = []
    latest = parse_time(at)
    for point in points:
        days = (latest - parse_time(point["at"])).total_seconds() / 86400
        if days < 14:
            recent.append(point)
        elif days <= 365:
            by_week[parse_time(point["at"]).strftime("%G-%V")] = point
    record["snapshots"] = list(by_week.values())[-52:] + recent


def growth(record):
    points = record.get("snapshots", [])
    if len(points) < 2:
        return {
            "delta": None,
            "weekly_delta": None,
            "from": None,
            "to": record.get("observed_at"),
            "days": None,
        }
    latest = points[-1]
    candidates = [
        p
        for p in points[:-1]
        if (parse_time(latest["at"]) - parse_time(p["at"])).total_seconds() >= 86400
    ]
    if not candidates:
        return {
            "delta": None,
            "weekly_delta": None,
            "from": None,
            "to": latest["at"],
            "days": None,
        }
    previous = min(
        candidates,
        key=lambda p: abs(
            (parse_time(latest["at"]) - parse_time(p["at"])).total_seconds() / 86400 - 7
        ),
    )
    days = (
        parse_time(latest["at"]) - parse_time(previous["at"])
    ).total_seconds() / 86400
    delta = latest["stars"] - previous["stars"]
    return {
        "delta": delta,
        "weekly_delta": delta if 6 <= days <= 8 else None,
        "from": previous["at"],
        "to": latest["at"],
        "days": round(days, 2),
    }


def make_catalog(state, run):
    repositories = []
    for record in state["records"].values():
        c = record.get("classification", {})
        if c.get("decision") != "accepted":
            continue
        m = record["metadata"]
        repositories.append(
            {
                "id": m["id"],
                "full_name": m["full_name"],
                "name": m["name"],
                "url": m["html_url"],
                "description": m.get("description") or "",
                "domains": c["domains"],
                "tasks": c["tasks"],
                "tool_types": c["tool_types"],
                "classification": {
                    k: c[k]
                    for k in ["rule_version", "reason", "evidence", "software_evidence"]
                },
                "stars": m.get("stargazers_count", 0),
                "forks": m.get("forks_count", 0),
                "open_issues": m.get("open_issues_count", 0),
                "language": m.get("language"),
                "license": None
                if (m.get("license") or {}).get("spdx_id") == "NOASSERTION"
                else (m.get("license") or {}).get("spdx_id"),
                "topics": m.get("topics") or [],
                "archived": bool(m.get("archived")),
                "unavailable": bool(record.get("unavailable")),
                "created_at": m.get("created_at"),
                "pushed_at": m.get("pushed_at"),
                "first_seen_at": record["first_seen_at"],
                "observed_at": record["observed_at"],
                "evidence_checked_at": record.get("evidence_checked_at"),
                "growth": growth(record),
                "star_history": record.get("snapshots", []),
                "sources": record.get("sources", []),
                **record.get("links", {}),
            }
        )
    repositories.sort(key=lambda r: (-r["stars"], r["full_name"].lower()))
    catalog = {
        "schema_version": 1,
        "product": "OmicsAtlas-AI",
        "generated_at": run["finished_at"],
        "method_version": TAXONOMY["version"],
        "domains": [
            {k: v for k, v in d.items() if k in {"id", "en", "zh", "aliases"}}
            for d in TAXONOMY["domains"]
        ],
        "tasks": [
            {k: v for k, v in t.items() if k != "phrases"} for t in TAXONOMY["tasks"]
        ],
        "tool_types": TAXONOMY["tool_types"],
        "counts": {
            "accepted": len(repositories),
            "review": sum(
                r.get("classification", {}).get("decision") == "review"
                for r in state["records"].values()
            ),
            "pending": len(state["pending"]),
            "checked": len(state["records"]),
            "domains": {
                d["id"]: sum(d["id"] in r["domains"] for r in repositories)
                for d in TAXONOMY["domains"]
            },
        },
        "run": run,
        "attribution": [
            {
                "name": "GitHub",
                "url": "https://github.com",
                "note": "Repository metadata and linked README evidence",
            },
            {
                "name": "bio.tools",
                "url": "https://bio.tools",
                "license": "CC BY 4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "note": "Discovery links where listed in a repository's sources; descriptions remain from GitHub",
            },
        ],
        "repositories": repositories,
    }
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog):
    if catalog.get("schema_version") != 1:
        raise ValueError("Unsupported catalog schema")
    ids = set()
    domains = {d["id"] for d in catalog["domains"]}
    for r in catalog["repositories"]:
        if not isinstance(r["id"], int) or r["id"] in ids:
            raise ValueError("Duplicate or invalid GitHub ID")
        ids.add(r["id"])
        if not r["domains"] or not set(r["domains"]) <= domains:
            raise ValueError(f"Invalid domains: {r['full_name']}")
        if (
            not r["classification"]["evidence"]
            or not r["classification"]["software_evidence"]
        ):
            raise ValueError(f"Missing admission evidence: {r['full_name']}")
        if r["stars"] < 0 or not isinstance(r["stars"], int):
            raise ValueError("Invalid star observation")
        parse_time(r["observed_at"])
        if r["growth"]["delta"] is not None and not r["growth"]["from"]:
            raise ValueError("Growth without a baseline")
    if catalog["counts"]["accepted"] != len(ids):
        raise ValueError("Catalog count does not match its searchable records")
    for domain in domains:
        if catalog["counts"]["domains"][domain] != sum(
            domain in r["domains"] for r in catalog["repositories"]
        ):
            raise ValueError("Domain count mismatch")
