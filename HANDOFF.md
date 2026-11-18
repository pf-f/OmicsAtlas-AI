# OmicsAtlas-AI project record

## Agreed outcome

An English-first directory with a Chinese interface, covering 11 omics/biomedical
research domains. Accurate admission, full-library search, local bookmarks,
four-tool comparison, CSV/JSON exports, weekly GitHub Actions updates and static
GitHub Pages hosting. No paid API, account system or application server. Desktop
Web is the target. The user authorized implementation and redeployment.

## Current state

Implementation, remote rename, source push and live deployment are complete.
On 2026-11-18 GitHub CLI authentication as `pf-f` and repository administration/
workflow permissions were verified. The repository was renamed in place,
preserving repository ID `1178441962` and all history. Pages uses explicit
Actions publishing and retains the existing `main`-only environment policy.

- Repository: https://github.com/pf-f/OmicsAtlas-AI
- Live site: https://pf-f.github.io/OmicsAtlas-AI/
- Implementation commit: `1faee16e08ba67013cb820604135065ef270f7af`.
- Initial publish: [44216669791](https://github.com/pf-f/OmicsAtlas-AI/actions/runs/44216669791), successful.
- Real collection and republish: [44216859060](https://github.com/pf-f/OmicsAtlas-AI/actions/runs/44216859060), successful.
- Automatic data commit: `644e9af324989e85e5db584102ffad1b8d16e9df`;
  changed exactly `data/state.json`, `data/runs.json`, `docs/data/catalog.json`.
- Working branch: `main`, synchronized with origin before this delivery record.
- Local preview server: `http://127.0.0.1:8000`, serving `docs/` (started for this task).
- Current real catalog: **221 accepted tools**, 11 domains; 328 unique repositories
  checked, 67 awaiting review, 3,646 candidates pending. Counts are a snapshot,
  not a promise of exhaustive GitHub coverage.
- The real Actions refresh on 2026-11-18 used 380 HTTP requests, completed 22
  discovery queries, refreshed all 214 existing entries, and checked 99 evidence
  inputs. There were no read errors. All earlier star samples were preserved;
  298 records now have multiple observations. No repository yet has a 6–8 day
  baseline, so weekly growth remains null. Pending candidates reflect the
  configured sampling/enrichment budget, not collection failure.
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

The desktop directory uses a sticky header, a cool gray page and a white
results card. Local organization initials anchor rows. A shared palette maps
domain IDs to named color tags across navigation, rows, details and comparison.
Numbers align in monospace, and a dash links the visual state of missing weekly
growth to an explanation in the table header.

Search covers the full catalog and waits for IME composition to finish.
Native filter controls support keyboard input. The URL stores filters, sort,
and page, bookmarks stay local, and exports include every filtered result.
The source evidence dialog renders linked excerpts as text.

With the same November 18 snapshot at 1280×720, the first screen fits three
complete rows in either language. Median row height is about 86 CSS pixels,
compared with about 120 before the update.

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
  excluded. Additional group: 17/22 accepted; five remain uncertain rather than
  being forced into the directory. Their expected admission is still a
  miss: SpaGCN, OpenFold, BCFtools, Flye and Crux. This is a small selected sample,
  not population accuracy. Strict domain-label metrics are reported separately
  by the evaluator; broad multi-domain tags still need ongoing curation.
- `python scripts/update_catalog.py --validate`: 221 unique tools after the real
  refresh; canonical state and public snapshot match.
- `python tests/browser_check.py`: all 13 flow groups passed using the actual
  catalog under `/OmicsAtlas-AI/`. Search, URL/back restoration, pagination,
  bookmark persistence/import/export, four-way comparison, source detail,
  accessible dialog names, focus, modal copy feedback, advanced-filter collapse,
  sort reset, Chinese search, CSV content/safety and failure/retry/stale/XSS states.
- `python tests/native_zoom_check.py`: Chromium's actual tab zoom set to **200%**
  in an isolated temporary browser profile. Layout viewport changed 1440→720 CSS
  pixels, DPR 1→2, CSS zoom remained unset. Reflow, search, details, Escape and
  focus return passed. Separate CSS zoom checks also passed.
- `ruff check scripts tests --select F`: passed. New Python/JS/CSS were formatted.
- Both workflows parse; the production workflow ran successfully twice on
  GitHub-hosted Python 3.12, including backend, classification, browser and native
  zoom checks before publication. Official action tags were checked to exist:
  checkout@v7, setup-python@v7, upload-pages-artifact@v4, deploy-pages@v4.
- `git diff --check`: passed before final handoff update.

Browser evidence/logs are local in ignored `.artifacts/`: `directory-en.png`,
`directory-zh.png`, `comparison.png`, `detail.png`, `desktop-1280.png`,
`desktop-native-zoom-200.png`, `browser-results.json`, `native-zoom-results.json`,
`backend-tests.log` and `classification-evaluation.json`. These are internal
execution evidence, not a claim of final user experience acceptance.

## Deployment and operations

Deployment is complete; no user action or additional credential is required.
Follow [DEPLOYMENT.md](DEPLOYMENT.md) for subsequent manual refreshes, deploy-only
runs and recovery. Repository visibility remains public. Only `main` may deploy.
The repository homepage now links to the live Pages site.

Both the initial publish and the real refresh completed their build/deploy jobs.
The live site returned HTTP 200, displayed the new brand, and its catalog exactly
matched the data commit (SHA-256
`5727f8031a765971ef156710f3da8b6ad3adb7c2738c142b873cfedc75d12d44`).
A browser on the actual public URL verified full-library search, linked evidence,
bookmark persistence, tool comparison, a real JSON download, Chinese switching
and Chinese search. No page errors or failing site requests were observed.
Screenshots: `.artifacts/live-directory-en.png`, `live-directory-zh.png`,
`live-comparison.png`; temporary test script: `.cache/live_check.py`.

The active workflow keeps **Sunday 00:23 UTC / 08:23 China time** updates. This
exact collection→validation→data commit→artifact→deployment path has been tested
by manual dispatch. The next scheduled execution (2026-11-22) can only be confirmed
after it actually occurs; do not claim a future cron event has already run.

The website is https://pf-f.github.io/OmicsAtlas-AI/ . GitHub redirects old
repository links, but does not automatically redirect the old Pages project URL.
The local clone directory keeps its existing name to preserve workspace paths.
