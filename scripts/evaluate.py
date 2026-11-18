#!/usr/bin/env python3
"""Evaluate frozen real-repository samples, separately from synthetic tests."""

import json
from atlas.classify import classify, ROOT, RULE_VERSION


def evaluate():
    samples = json.loads((ROOT / "tests/fixtures/classification.json").read_text())
    labels = json.loads((ROOT / "tests/fixtures/labels.json").read_text())
    samples = {s["full_name"].lower(): s for s in samples}
    output = {
        "method_version": RULE_VERSION,
        "note": "Small purposive regression sample, not population accuracy. Domain labels describe the annotated scope; extra labels count against precision.",
        "sets": {},
    }
    failures = []
    for split in ["development", "additional-check"]:
        tp = fp = fn = label_tp = label_fp = label_fn = 0
        misses = []
        for target in (s for s in labels if s["split"] == split):
            sample = samples.get(target["full_name"].lower())
            if sample is None:
                raise ValueError("Missing evaluation sample: " + target["full_name"])
            result = classify(
                sample["metadata"], sample["readme"], sample.get("files", [])
            )
            accepted = result["decision"] == "accepted"
            tp += accepted and target["accepted"]
            fp += accepted and not target["accepted"]
            fn += not accepted and target["accepted"]
            actual = set(result["domains"]) if accepted else set()
            expected = set(target["domains"])
            label_tp += len(actual & expected)
            label_fp += len(actual - expected)
            label_fn += len(expected - actual)
            if accepted != target["accepted"]:
                misses.append(
                    {
                        "repository": target["full_name"],
                        "expected_accepted": target["accepted"],
                        "actual": result["decision"],
                        "reason": result["reason"],
                    }
                )
            if accepted and not target["accepted"]:
                failures.append(target["full_name"])
        output["sets"][split] = {
            "admission_precision": round(tp / max(1, tp + fp), 3),
            "admission_recall": round(tp / max(1, tp + fn), 3),
            "domain_precision": round(label_tp / max(1, label_tp + label_fp), 3),
            "domain_recall": round(label_tp / max(1, label_tp + label_fn), 3),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "admission_mismatches": misses,
        }
    print(json.dumps(output, indent=2))
    # Known unrelated projects and resource collections are blocking regressions.
    if failures:
        raise SystemExit("False-positive regression: " + ", ".join(failures))
    return output


if __name__ == "__main__":
    evaluate()
