# Classification evaluation snapshots

`labels.json` fixes the intended tool admission and domain labels independently
of the classifier. `classification.json` holds public repository metadata and
README excerpts (up to 150,000 characters, matching the collector limit), source URLs and retrieval dates.
The development set contains core tools and previously observed false positives.
The additional check set uses different repositories and is not used for rule
fitting. These small, deliberately selected samples are regression evidence,
not a representative estimate of accuracy across GitHub.

Repository metadata comes from GitHub; README content remains attributed to its
linked source repository and its original license. Test inputs are never run.
`python scripts/evaluate.py` reports admission precision/recall and domain-label
precision/recall separately. Review/insufficient-evidence is not acceptance.
