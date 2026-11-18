# OmicsAtlas-AI

An evidence-linked directory for finding and comparing open research software.
English first, with a Chinese interface. Runs as a static site on GitHub Pages;
collection runs weekly in GitHub Actions without a paid API or application server.

Repository: **https://github.com/pf-f/OmicsAtlas-AI**

Website: **https://pf-f.github.io/OmicsAtlas-AI/**

Previously named `sc-st-proAI-toolkit`. See [deployment instructions](DEPLOYMENT.md)
for authentication, publishing, recovery and the repository rename history.

## What you can do

- Search every accepted tool, including tools outside the popular lists.
- Filter by research domain, task, tool type, language, license and environment.
- Inspect admission evidence, original documentation, installation excerpts,
  paper links and the actual observation dates.
- Save tools locally, compare up to four, and export filtered results to CSV/JSON.
- Export/import bookmarks to move them between browsers. No account is needed.
- Explore popular tools, newly discovered projects and measured weekly growth.

Domains: Single-cell, Spatial omics, Multi-omics, Protein AI, AI pathology,
Genomics, Transcriptomics, Epigenomics, Proteomics, Metabolomics, Metagenomics.
Domains, analysis tasks and software types are independent, multiple labels.
Protein AI does not automatically imply mass-spectrometry proteomics.

## Start locally

Python 3.12+ is supported. A current Chrome, Firefox, Safari or Edge can run the
static site; Node and a frontend build are not needed.

```bash
python -m pip install -r requirements.txt
python -m http.server 8000 --directory docs
```

Open **http://localhost:8000**. The checked-in snapshot works immediately.
Do not open `index.html` directly with a `file://` URL: browsers block JSON fetches.

To refresh data locally, authenticate with GitHub CLI or put a token in your
shell's `GITHUB_TOKEN` environment variable. The collector also accepts `GH_TOKEN`.
Never place a token in the website, command history, committed files or screenshots.
GitHub Actions receives its repository token automatically.

```bash
# If using GitHub CLI, authenticate first; shell expansion is local.
GITHUB_TOKEN="$(gh auth token)" python scripts/update_catalog.py

# Validate the catalog and confirm that it matches durable state (no network).
python scripts/update_catalog.py --validate

# Rebuild the public snapshot from state without new observations.
python scripts/update_catalog.py --rebuild
```

Public unauthenticated reads are also supported, but GitHub's smaller rate limit
may stop a local refresh early. The site never needs a visitor's GitHub token.

## How admission works

1. Discover candidates through precise GitHub topics, research phrases, recent
   projects, a small documented seed list and bio.tools repository links.
2. Require explicit research-purpose evidence **and** documented software use,
   a matching package release, installer or software manifest.
3. Match whole words/phrases in descriptions, exact topics and introductory
   project prose. Reference lists, badges and code examples do not assign domains.
   Ambiguous short names are insufficient; named protein methods need protein context.
4. Preserve the matched excerpt, source URL and method version. Uncertain
   candidates wait for review; pure reading lists, books and skill collections
   are excluded from the software directory.

The rules and domain aliases live in `config/taxonomy.json`; seed candidates
in `config/seeds.json` pass the same admission checks. Registry matches are
candidates too. Results are a sampled directory, not exhaustive GitHub coverage.
Classification indicates relevance, not a validation of scientific performance.

Stars are a popularity signal, not a quality score. There is no combined
"scientific quality" score. Paper links mean "mentioned in the README", not
verified citations or endorsements. Installation excerpts may include optional
steps and dependencies: read their source before using them.

## Updates, history and failures

The production workflow updates on Sundays at **00:23 UTC / 08:23 China time**,
with manual update and deploy-only options. Scheduled execution may be delayed
by GitHub. A source push deploys the checked-in snapshot without a full crawl.

Collection is incremental: oldest accepted observations are refreshed first,
queries are deduplicated, candidates are interleaved by domain, and the pending
queue survives runs. Defaults: 800 total HTTP requests, 22 search queries,
2 pages/query, up to 300 repository metadata refreshes and 100 evidence checks.
These are sampling budgets, not admission thresholds. Configure with `--help`.
A capped search is counted in the run record, not represented as complete coverage.

GitHub IDs preserve identity across renames. State retains roughly a year of
star observations: recent daily samples and older weekly samples. Same-day retries replace that day's sample;
negative growth is kept. Only observation intervals of 6–8 days produce weekly
growth. First observations and gaps have no weekly baseline, displayed as unknown.

A repository read failure retains its previous entry and dates. Authentication,
validation or run-wide failures stop publication. Retries are finite. The workflow
commits only state, run history and the matching public catalog, then explicitly
deploys that artifact; bot commits need not trigger a second workflow.

Durable inputs and outputs:

- `data/state.json`: observations, admission evidence, snapshots, queued candidates
  and discovery cursor. **Keep this file; it cannot be recreated from the website.**
- `data/runs.json`: bounded collection history.
- `docs/data/catalog.json`: complete, deduplicated public catalog, rebuilt from state.
- `.cache/`: disposable HTTP cache and failed-run diagnostics, never published.
- `data/legacy/`: unmodified old reports, retained only as historical inputs.

The old report's 2,708 total was not a recoverable full catalog. It exported 81
unique entries, contained known classification mistakes, and had no reliable
star history. These entries were imported as candidates, not trusted classifications.
Old growth and PubMed search counts are not migrated as real observations.

## Validation and contributions

```bash
python -m unittest discover -s tests
python scripts/evaluate.py
python scripts/update_catalog.py --validate

python -m pip install -r requirements-dev.txt
python -m playwright install --with-deps chromium
python tests/browser_check.py
python tests/native_zoom_check.py
```

The browser check serves the real snapshot under `/OmicsAtlas-AI/`, operates the
search, filters, saved lists, comparison and exports, and checks failure states.
Screenshots/results go to ignored `.artifacts/`. It also exercises CSS 200% zoom
reflow. The separate native zoom check uses Chromium's real tab zoom in a
temporary test profile and verifies search, details and focus at 200%.

The classification evaluation uses 66 real repositories, frozen source snapshots,
and separate development/additional check groups. Synthetic edge cases live in
unit tests. Evaluation results are sample-specific; see [project record](HANDOFF.md)
for actual results, limitations and deployment status.

When changing classification rules, add independently labeled examples, bump the
method version, and recheck evidence. Never manufacture star observations or
change labels just to make a score pass. The old CLI entrypoint remains a wrapper
around `scripts/update_catalog.py`.

## Sources and license

Repository metadata and README evidence link to GitHub. bio.tools discovery data
is attributed under [CC BY 4.0](https://biotools.readthedocs.io/en/latest/license.html).
Descriptions stay in their original language; the bilingual interface does not
invent translations or scientific summaries. Original tool licenses govern those
tools; a missing license is displayed as unspecified.

This project's code is licensed under [MIT](LICENSE).
