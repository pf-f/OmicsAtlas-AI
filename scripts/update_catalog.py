#!/usr/bin/env python3
"""Collect or validate the complete OmicsAtlas-AI directory."""

import argparse
import json
from pathlib import Path
import sys

from atlas.classify import ROOT
from atlas.collect import collect
from atlas.github import RemoteError
from atlas.store import atomic_json, load_state, make_catalog, validate_catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=str(ROOT / "data"))
    parser.add_argument("--output-dir", default=str(ROOT / "docs/data"))
    parser.add_argument("--request-budget", type=int, default=800)
    parser.add_argument("--query-limit", type=int, default=22)
    parser.add_argument("--pages", type=int, choices=range(1, 11), default=2)
    parser.add_argument("--refresh-limit", type=int, default=300)
    parser.add_argument("--enrich-limit", type=int, default=100)
    parser.add_argument(
        "--registry", action=argparse.BooleanOptionalAction, default=True
    )
    parser.add_argument(
        "--validate", action="store_true", help="Validate without network or writes"
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Rebuild from state without changing observations",
    )
    args = parser.parse_args()
    if (
        min(
            args.request_budget, args.query_limit, args.refresh_limit, args.enrich_limit
        )
        < 0
    ):
        parser.error("Budgets must be nonnegative")
    try:
        if args.validate:
            catalog = json.loads((Path(args.output_dir) / "catalog.json").read_text())
            validate_catalog(catalog)
            state_file = Path(args.data_dir) / "state.json"
            if state_file.exists():
                state = load_state(state_file)
                if (
                    not state["runs"]
                    or make_catalog(state, state["runs"][-1]) != catalog
                ):
                    raise ValueError(
                        "Public catalog differs from the persisted observations; rebuild before publishing"
                    )
            print(f"Valid catalog: {len(catalog['repositories'])} unique tools")
        elif args.rebuild:
            state = load_state(Path(args.data_dir) / "state.json")
            if not state["runs"]:
                raise ValueError("No valid run available to rebuild")
            atomic_json(
                Path(args.output_dir) / "catalog.json",
                make_catalog(state, state["runs"][-1]),
            )
        else:
            collect(args)
    except (RemoteError, ValueError, OSError) as exc:
        print(f"OmicsAtlas-AI: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
