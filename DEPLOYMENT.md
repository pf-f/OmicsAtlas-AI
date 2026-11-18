# Rename and deploy OmicsAtlas-AI

Local implementation can be previewed without GitHub access. Repository rename,
push and remote workflow verification need write/admin access to `pf-f`'s repository.
No deployment credential is stored in this project, and no paid service is needed.

## 1. Inspect and authenticate

Run from this repository. Install GitHub CLI (`gh`) if needed, then sign in on your
own terminal/browser. Do not paste a personal access token into a chat message.

```bash
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
gh auth status
```

On a headless server, use `GH_BROWSER=echo` for the login command:

```bash
GH_BROWSER=echo gh auth login --hostname github.com --git-protocol https --web --scopes workflow
```

Keep that terminal open. Copy the one-time code shown by `gh`, press Enter when
prompted, then open https://github.com/login/device on your own computer or phone.
Sign in as the repository owner, enter the code and approve GitHub CLI. The
server does not need a graphical browser. After the terminal confirms login,
run `gh auth setup-git` and `gh auth status` in the same server account used for
this project. The extra `workflow` scope is needed to push the Actions changes.

If you prefer your existing Git/SSH setup, use it for pushing and perform the
settings changes below on GitHub's website. Your account must administer the repo.

## 2. Verify locally before publishing

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests
python scripts/evaluate.py
python scripts/update_catalog.py --validate
python -m playwright install --with-deps chromium
python tests/browser_check.py
python tests/native_zoom_check.py
```

The state and catalog already include real collected data. A new collection is
optional for the first deployment. Later updates get the workflow's built-in token.

## 3. Rename and configure Pages

On GitHub, open `pf-f/sc-st-proAI-toolkit` → **Settings → General → Repository name**,
rename to **OmicsAtlas-AI**. Then update the local remote:

```bash
git remote set-url origin https://github.com/pf-f/OmicsAtlas-AI.git
```

In the renamed repository:

1. **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. **Settings → Actions → General**: enable Actions and permit the workflow's
   requested read/write repository permission if an account policy limits it.
3. If the `github-pages` environment requires approval, approve the deployment
   in the Actions UI. Branch rules may separately require a pull request or allow
   the repository's bot to commit data; do not disable protections indiscriminately.

The new URL is **https://pf-f.github.io/OmicsAtlas-AI/**. GitHub redirects old
repository links, but does not redirect the old Pages project URL. Do not recreate
an unrelated repository using the old name, because that breaks repository redirects.

## 4. Commit the reviewed project files and push

Inspect `git status` and `git diff` first. This command deliberately selects the
project files and excludes local skills, caches, screenshots and credentials:

```bash
git add .github .gitignore AGENTS.md HANDOFF.md README.md DEPLOYMENT.md LICENSE requirements.txt requirements-dev.txt config scripts tests data docs
git diff --cached --stat
git commit -m "feat: rebuild research directory as OmicsAtlas-AI"
git push origin main
```

If Git asks for identity, configure **your own** name/email locally for this
repository. If `main` is protected, push the change to a branch, open a PR, wait
for checks, and merge through the existing repository policy.

## 5. Verify the live site and update task

The push starts **OmicsAtlas-AI update and deploy** using the existing catalog.
Once it succeeds, open the new URL, find a tool, inspect its evidence and confirm
the displayed snapshot date. Test saved tools and comparison in your browser.

Then trigger a real update:

```bash
gh workflow run main.yml --repo pf-f/OmicsAtlas-AI --ref main -f collect=true -f request_budget=800
gh run list --repo pf-f/OmicsAtlas-AI --workflow main.yml --limit 5
```

Open the latest run (or `gh run watch RUN_ID --repo pf-f/OmicsAtlas-AI`). Confirm
both build and deploy jobs succeed; the summary reports accepted, pending and
per-domain counts. Data commits must touch only the three intended data files.

Refresh the live page and compare `data/catalog.json` with the committed snapshot.
First-run weekly growth is unknown until another real observation 6–8 days later.
The Sunday schedule remains enabled; verify its next actual run in Actions.

## Recover or retry

- A collection failure leaves the previously deployed site online. Inspect the
  run log; fix authentication/rate-limit/network issues before repeating.
- A push conflict stops deployment. Fetch and reconcile changes; never force-push
  generated state over another update.
- If deployment alone fails after data was committed, rerun the failed deploy job,
  or manually dispatch `main.yml` with **collect=false**. No recollection is needed.
- To restore a previous version, revert the relevant source/data commit together,
  validate catalog/state consistency, and deploy with collection disabled. Do not
  restore only `catalog.json` while leaving mismatched state behind.
- HTTP cache can be removed safely. Preserve `data/state.json` and its Git history.

Official references: [repository rename](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
[Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[GitHub API limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
