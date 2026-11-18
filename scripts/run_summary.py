"""GitHub job summary; no new API calls or synthetic success statuses."""

import json
from pathlib import Path

c = json.loads(
    (Path(__file__).resolve().parents[1] / "docs/data/catalog.json").read_text()
)
print("# OmicsAtlas-AI directory snapshot\n")
print(f"Generated: {c['generated_at']} · Method: {c['method_version']}\n")
for key, value in c["counts"].items():
    if key != "domains":
        print(f"- {key}: {value}")
print(f"\nCollection status: {c['run']['status']}\n")
print("| Domain | Listed tools |\n|---|---:|")
for domain, count in c["counts"]["domains"].items():
    print(f"| {domain} | {count} |")
print(
    "\nSnapshot generation is separate from Pages deployment. Check the deployment job for publication status."
)
