"""Bounded, resumable HTTP access. Credentials never leave api.github.com."""

import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import requests


class RemoteError(RuntimeError):
    pass


class AuthenticationError(RemoteError):
    pass


class BudgetExhausted(RemoteError):
    pass


class Client:
    def __init__(self, budget=800, cache_dir=None, token=None):
        self.session = requests.Session()
        self.token = (
            token
            if token is not None
            else os.getenv("GITHUB_TOKEN", "") or os.getenv("GH_TOKEN", "")
        )
        self.budget = budget
        self.requests = 0
        self.errors = []
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.last_search = 0
        self.remaining = None

    def get(self, url, params=None, *, text=False, optional=False):
        is_api = urlparse(url).hostname == "api.github.com"
        if self.requests >= self.budget:
            raise BudgetExhausted(
                "Configured request budget reached; pending work is retained"
            )
        if is_api and self.remaining is not None and self.remaining < 5:
            raise BudgetExhausted(
                "GitHub request reserve reached; continuing on the next run"
            )
        if is_api and "/search/" in url:
            delay = (2.1 if self.token else 6.2) - (time.monotonic() - self.last_search)
            if delay > 0:
                time.sleep(delay)
            self.last_search = time.monotonic()
        headers = {
            "User-Agent": "OmicsAtlas-AI/1.0 (+https://github.com/pf-f/OmicsAtlas-AI)",
            "Accept": "application/vnd.github+json" if is_api else "*/*",
        }
        if is_api:
            headers["X-GitHub-Api-Version"] = "2022-11-28"
            if self.token:
                headers["Authorization"] = f"Bearer {self.token}"
        cache_path = None
        cached = None
        if self.cache_dir:
            digest = hashlib.sha256(
                (url + json.dumps(params or {}, sort_keys=True)).encode()
            ).hexdigest()
            cache_path = self.cache_dir / f"{digest}.json"
            if cache_path.exists():
                try:
                    cached = json.loads(cache_path.read_text())
                    if cached.get("etag"):
                        headers["If-None-Match"] = cached["etag"]
                except (ValueError, OSError):
                    cached = None
        for attempt in range(3):
            if self.requests >= self.budget:
                raise BudgetExhausted("Request budget reached during retry")
            self.requests += 1
            try:
                response = self.session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=(10, 30),
                    allow_redirects=True,
                )
                if (
                    is_api
                    and response.headers.get("X-RateLimit-Resource", "core") == "core"
                    and "X-RateLimit-Remaining" in response.headers
                ):
                    self.remaining = int(response.headers["X-RateLimit-Remaining"])
                if response.status_code == 304 and cached:
                    return cached["body"]
                if response.status_code == 401:
                    raise AuthenticationError(
                        "GitHub rejected the credential; previous catalog retained"
                    )
                if response.status_code in {403, 429}:
                    limited = (
                        response.status_code == 429
                        or response.headers.get("X-RateLimit-Remaining") == "0"
                        or "rate limit" in response.text.lower()
                    )
                    if limited:
                        raise BudgetExhausted(
                            "GitHub rate limit reached; pending work is retained"
                        )
                    raise RemoteError(
                        f"HTTP {response.status_code}: access denied for {url}"
                    )
                if response.status_code == 404 and optional:
                    return None
                if response.status_code >= 500:
                    if attempt == 2:
                        raise RemoteError(f"HTTP {response.status_code}: {url}")
                    time.sleep(2**attempt)
                    continue
                if not response.ok:
                    raise RemoteError(f"HTTP {response.status_code}: {url}")
                body = response.text if text else response.json()
                if cache_path:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    cache_path.write_text(
                        json.dumps({"etag": response.headers.get("ETag"), "body": body})
                    )
                return body
            except (requests.RequestException, ValueError) as exc:
                if attempt == 2:
                    raise RemoteError(
                        f"Read failed for {url}: {type(exc).__name__}"
                    ) from exc
                time.sleep(2**attempt)
        raise RemoteError(f"Read failed: {url}")

    def repository(self, full_name):
        return self.get(f"https://api.github.com/repos/{full_name}", optional=True)

    def readme(self, repo):
        # Raw files avoid spending the small REST quota on large unchanged
        # READMEs. Auth is intentionally not attached to public raw downloads.
        branch = repo.get("default_branch") or "HEAD"
        for name in ["README.md", "README.rst", "README", "readme.md"]:
            body = self.get(
                f"https://raw.githubusercontent.com/{repo['full_name']}/{branch}/{name}",
                text=True,
                optional=True,
            )
            if body is not None:
                return body[:150000]
        # Handles repos that keep documentation below the root.
        meta = self.get(
            f"https://api.github.com/repos/{repo['full_name']}/readme", optional=True
        )
        if not meta:
            return ""
        import base64

        return base64.b64decode(meta.get("content", "")).decode("utf-8", "replace")[
            :150000
        ]

    def search(self, query, sort="stars", page=1):
        return self.get(
            "https://api.github.com/search/repositories",
            {"q": query, "sort": sort, "order": "desc", "per_page": 100, "page": page},
        )

    def software_files(self, repo):
        candidates = {
            "Python": ["pyproject.toml", "setup.py"],
            "Jupyter Notebook": ["pyproject.toml", "setup.py"],
            "R": ["DESCRIPTION"],
            "HTML": ["pyproject.toml", "setup.py"],
            "C": ["Makefile", "CMakeLists.txt"],
            "C++": ["CMakeLists.txt", "Makefile"],
            "Java": ["build.gradle", "build.gradle.kts", "pom.xml"],
            "Nextflow": ["main.nf"],
        }.get(repo.get("language"), [])
        branch = repo.get("default_branch") or "HEAD"
        for file in candidates:
            body = self.get(
                f"https://raw.githubusercontent.com/{repo['full_name']}/{branch}/{file}",
                text=True,
                optional=True,
            )
            if body is not None:
                return [file]
        return []
