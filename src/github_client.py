"""
Thin GitHub REST API client.

Design choices (see README for the why):
- Only reads the profile "email" field GET /users/{username} returns.
  That field is null unless the user chose to make their email public --
  we never fall back to scraping commit metadata for emails.
- Respects both the Search API's tighter rate limit and the core API's
  rate limit, and backs off on secondary rate-limit / abuse responses
  instead of hammering GitHub.
"""

import time
from typing import Iterator, Optional

import requests

API_BASE = "https://api.github.com"


class GitHubClient:
    def __init__(self, token: str, search_delay: float, core_delay: float):
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "portfolio-github-etl-demo",
            }
        )
        self.search_delay = search_delay
        self.core_delay = core_delay

    def _get(self, path: str, params: Optional[dict] = None) -> requests.Response:
        url = f"{API_BASE}{path}"
        for attempt in range(5):
            resp = self._session.get(url, params=params, timeout=30)

            if resp.status_code == 200:
                return resp

            if resp.status_code in (403, 429):
                # Primary or secondary rate limit. Prefer Retry-After;
                # fall back to X-RateLimit-Reset; else exponential backoff.
                retry_after = resp.headers.get("Retry-After")
                reset_at = resp.headers.get("X-RateLimit-Reset")
                if retry_after:
                    wait = float(retry_after)
                elif reset_at:
                    wait = max(0.0, float(reset_at) - time.time()) + 1
                else:
                    wait = 2 ** attempt
                print(f"[github] rate/abuse limited on {path}, sleeping {wait:.0f}s")
                time.sleep(wait)
                continue

            if resp.status_code == 404:
                return resp

            if 500 <= resp.status_code < 600:
                wait = 2 ** attempt
                print(f"[github] {resp.status_code} on {path}, retrying in {wait}s")
                time.sleep(wait)
                continue

            resp.raise_for_status()

        resp.raise_for_status()
        return resp

    def search_users(self, query: str, per_page: int = 30) -> Iterator[dict]:
        """Yields user search results (login, id, ...) for a query, paging as needed."""
        page = 1
        while True:
            resp = self._get(
                "/search/users",
                params={"q": query, "per_page": per_page, "page": page},
            )
            data = resp.json()
            items = data.get("items", [])
            if not items:
                return
            for item in items:
                yield item
            if len(items) < per_page:
                return
            page += 1
            time.sleep(self.search_delay)

    def get_user(self, username: str) -> Optional[dict]:
        """Full profile for a user, including the public 'email' field (often null)."""
        resp = self._get(f"/users/{username}")
        time.sleep(self.core_delay)
        if resp.status_code == 404:
            return None
        return resp.json()
