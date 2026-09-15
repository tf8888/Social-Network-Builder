"""
Config for the GitHub -> Supabase ETL demo.

This project is a small, capped portfolio demo, not a production scraper.
HARD_MAX_USERS is an intentional ceiling that cannot be raised via env vars —
see README.md for why.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

# Intentional hard ceiling. Not configurable via env var on purpose:
# this project is meant to stay demo-scale. Raise it in code, deliberately,
# if you truly need to -- don't just bump an env var.
HARD_MAX_USERS = 100


@dataclass(frozen=True)
class Settings:
    github_token: str
    supabase_url: str
    supabase_service_key: str
    max_users: int
    search_delay_seconds: float
    core_delay_seconds: float


def load_settings() -> Settings:
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_service_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

    if not github_token:
        raise RuntimeError(
            "GITHUB_TOKEN is not set. Create a token at "
            "https://github.com/settings/tokens and put it in .env"
        )
    if not supabase_url or not supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY are not set in .env. "
            "Use the service_role key (Project Settings -> API), not the "
            "publishable/anon key -- the anon key can't write rows unless "
            "you add RLS policies for it."
        )

    requested = int(os.environ.get("MAX_USERS", "20"))
    max_users = max(1, min(requested, HARD_MAX_USERS))
    if requested > HARD_MAX_USERS:
        print(
            f"[config] MAX_USERS={requested} requested, capping to "
            f"{HARD_MAX_USERS} (hard ceiling, see README)."
        )

    return Settings(
        github_token=github_token,
        supabase_url=supabase_url,
        supabase_service_key=supabase_service_key,
        max_users=max_users,
        search_delay_seconds=float(os.environ.get("SEARCH_DELAY_SECONDS", "2.5")),
        core_delay_seconds=float(os.environ.get("CORE_DELAY_SECONDS", "1.0")),
    )
