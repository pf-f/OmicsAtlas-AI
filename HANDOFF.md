# OmicsAtlas-AI project record

## Agreed outcome

An English-first directory with a Chinese interface, covering 11 omics/biomedical
research domains. Accurate admission, full-library search, local bookmarks,
four-tool comparison, CSV/JSON exports, weekly GitHub Actions updates and static
GitHub Pages hosting. No paid API, account system or application server. Desktop
Web is the target. The user authorized implementation and redeployment.

## Current state

Local implementation and checks are complete. On 2026-11-18 the user authenticated
GitHub CLI as `pf-f`; repository administration/write and workflow scopes were
verified. Repository **pf-f/OmicsAtlas-AI** has been renamed successfully, keeping
its original repository ID and history. Pages is being switched to explicit
GitHub Actions publishing. Source commit, production deployment and a real manual
refresh are in progress; do not claim them complete until verified.

- Working branch: `main`, based on `7a4b6fd`, pending the initial upgrade commit.
- Local preview server: `http://127.0.0.1:8000`, serving `docs/` (started for this task).
- Current real catalog: **214 accepted tools**, 11 domains; 319 unique repositories
  checked, 65 awaiting review, 1,649 candidates pending. Counts are a snapshot,
  not a promise of exhaustive GitHub coverage.
- Source metadata/READMEs were retrieved during this task. The final initial
  source recheck reused that retrieved content and retained original star
  observation dates; it did not fabricate a new star sample.
- Product and repository name: OmicsAtlas-AI. Origin now points to
  `https://github.com/pf-f/OmicsAtlas-AI.git`.
- The local user-supplied `.agents/` directory was preserved and excluded from Git.

## Baseline and decisions

- Both collection and Pages deployment succeeded on 2026-11-15. A stopped
  scheduler was not reproduced. The main defects were false classifications,
  truncated search, ephemeral SQLite history and misleading citation metadata.
- Legacy output claimed 2,708 repositories but exported 81 unique records.
  Unmodified originals are archived under `data/legacy/`; only their repository
  links were used as candidates. Old citation/search counts and zero growth were
  not carried forward as reliable observations.
- Method **1.4** separates discovery, admission and ordering. Explicit domain
  purpose plus documented software use is required. Whole-word/phrase matching,
  contextual protein-method matching, project introduction boundaries and
  explicit resource exclusions replace broad substring admission.
- Domains, analysis tasks and tool types are independent tags. Every accepted
  entry retains evidence and sources. Unclear projects remain under review.
- No synthetic scientific-quality score. Stars and measured growth are sorting
  signals; paper URLs are explicitly README mentions, not citation counts.
- GitHub repository ID preserves identity. State retains roughly a year of
  observations, recent daily samples and older weekly samples. Missing growth is
  null, negative growth is preserved, and only 6–8 day intervals count as weekly.
  UTC offsets are normalized; stale samples cannot overwrite newer observations.
- A failed single read retains the previous record and dates. A run-wide failure
  prevents public replacement. Request/retry budgets and saved queues bound work.

## Code and data contract

- `scripts/update_catalog.py`: maintained CLI, with validate/rebuild controls.
  `scripts/sc_st_proai_gateway.py` remains a compatibility entrypoint.
- `scripts/atlas/`: discovery/collection, evidence classification, HTTP and state.
- `config/`: domain/task taxonomy and seed candidates; seeds do not bypass checks.
- `data/state.json`: canonical observations, classifications, queue and run state;
  preserve this and its Git history. `data/runs.json` is the run-history export.
- `docs/data/catalog.json`: complete public catalog, `schema_version: 1`, with
  stable IDs, source times, evidence, domain/task/type definitions and run coverage.
  `--validate` confirms that the public catalog matches canonical state.
- `.cache/`: disposable HTTP data/initial maintenance helpers, ignored.
- `docs/assets/`: readable native JavaScript/CSS, bilingual messages and SVG mark.

## Experience and visual decisions

A continuous directory with aligned metrics, compact navigation, white/near-white
surfaces and one blue accent. System fonts with Chinese fallback. Search covers
all accepted records, filter/sort/page context is URL-backed, bookmarks stay local,
and exports include every filtered result rather than only the displayed page.
Source evidence is shown in a named modal, with safe text rendering. Keyboard
focus, dialog feedback and empty saved-list recovery were tested.

Independent UI review used the actual rendered screenshots and Chromium. Five
specific findings (dialog naming, feedback under the modal, reopening filters,
new-discovery sort reset, focus after removing the last bookmark) were fixed.
The regression includes opening/closing details before removing the final saved
item, because hidden dialog controls must not capture the restored focus.

## Executed validation

- `python -m unittest discover -s tests`: **37 tests passed**. Covers admission,
  acronym collisions, README-only evidence, resources, installation extraction,
  timezones, same-week six-day baselines, negative/gapped growth, stale samples,
  HTTP failure/retry/304/auth handling, pagination and state preservation.
- `python scripts/evaluate.py`: 66 frozen real repository snapshots. Development
  group: 22/22 relevant tools accepted and 22/22 known irrelevant/resource entries
  excluded. Additional group: 17/22 accepted, five correctly retained as uncertain
  rather than forced into the directory. Their expected admission is still a
  miss: SpaGCN, OpenFold, BCFtools, Flye and Crux. This is a small selected sample,
  not population accuracy. Strict domain-label metrics are reported separately
  by the evaluator; broad multi-domain tags still need ongoing curation.
- `python scripts/update_catalog.py --validate`: 214 unique tools; canonical state
  and public snapshot match.
- `python tests/browser_check.py`: all 10 flow groups passed using the actual
  catalog under `/OmicsAtlas-AI/`. Search, URL/back restoration, pagination,
  bookmark persistence/import/export, four-way comparison, source detail,
  accessible dialog names, focus, modal copy feedback, advanced-filter collapse,
  sort reset, Chinese search, CSV content/safety and failure/retry/stale/XSS states.
- `python tests/native_zoom_check.py`: Chromium's actual tab zoom set to **200%**
  in an isolated temporary browser profile. Layout viewport changed 1440→720 CSS
  pixels, DPR 1→2, CSS zoom remained unset. Reflow, search, details, Escape and
  focus return passed. Separate CSS zoom checks also passed.
- `ruff check scripts tests --select F`: passed. New Python/JS/CSS were formatted.
- Both workflow YAML files parse. Official action tags were checked to exist:
  checkout@v7, setup-python@v7, upload-pages-artifact@v4, deploy-pages@v4.
- `git diff --check`: passed before final handoff update.

Browser evidence/logs are local in ignored `.artifacts/`: `directory-en.png`,
`directory-zh.png`, `comparison.png`, `detail.png`, `desktop-1280.png`,
`desktop-native-zoom-200.png`, `browser-results.json`, `native-zoom-results.json`,
`backend-tests.log` and `classification-evaluation.json`. These are internal
execution evidence, not a claim of final user experience acceptance.

## Deployment and next action

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for repeatable operations. GitHub login and
repository rename are complete. Existing production environment permits `main`
only and requires no reviewer approval; preserve that rule. Publish the reviewed
source, verify Actions and Pages, then run a manual collection and inspect the
resulting data commit and deployment. No additional user approval is needed.

Target URL: **https://pf-f.github.io/OmicsAtlas-AI/**. GitHub does not automatically
redirect the old Pages project address. Keep repository history and avoid
recreating an unrelated repository under the old name.

The workflow explicitly commits state/catalog before artifact upload/deploy,
serializes production runs, and keeps Sunday 00:23 UTC / 08:23 China time updates.
Remote permissions and branch/environment policy have been verified. Real Actions
execution and live URL checks are pending the source push. The next
scheduled run (2026-11-22) can only be confirmed after it actually occurs.
