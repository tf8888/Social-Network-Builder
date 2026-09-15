"""
Portfolio ETL demo: GitHub public profiles -> Supabase.

Usage:
    python -m src.main --keywords "location:portland language:python" --max-users 15
    python -m src.main --keywords "location:brazil" "topic:machine-learning" --dry-run

Scope, on purpose (see README.md):
  - Only reads the profile `email` field GitHub's public API returns
    (null unless the user opted in). Never scrapes commit-log emails.
  - Volume is capped (config.HARD_MAX_USERS), and this is a one-shot CLI run,
    not a scheduled/continuous scraper.
  - Skips users with no public email -- they are not stored at all.
"""

import argparse
import datetime as dt
import sys

from src.config import load_settings
from src.github_client import GitHubClient
from src.supabase_client import make_client, upsert_contact


def years_since(iso_timestamp: str) -> float:
    created = dt.datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
    now = dt.datetime.now(dt.timezone.utc)
    return round((now - created).days / 365.25, 1)


def build_record(profile: dict, search_keyword: str) -> dict:
    return {
        "github_id": profile["id"],
        "username": profile["login"],
        "name": profile.get("name"),
        "email": profile.get("email"),
        "avatar_url": profile.get("avatar_url"),
        "country": profile.get("location"),
        "portfolio_url": profile.get("blog") or None,
        "company": profile.get("company"),
        "bio": profile.get("bio"),
        "public_repos": profile.get("public_repos"),
        "followers": profile.get("followers"),
        "following": profile.get("following"),
        "account_created_at": profile.get("created_at"),
        "github_experience_years": (
            years_since(profile["created_at"]) if profile.get("created_at") else None
        ),
        "search_keyword": search_keyword,
    }


def run(keywords: list[str], max_users: int, dry_run: bool) -> None:
    settings = load_settings()
    effective_cap = min(max_users, settings.max_users)

    gh = GitHubClient(
        token=settings.github_token,
        search_delay=settings.search_delay_seconds,
        core_delay=settings.core_delay_seconds,
    )
    sb = None if dry_run else make_client(settings.supabase_url, settings.supabase_service_key)

    seen_ids: set[int] = set()
    stored = 0
    skipped_no_email = 0
    skipped_duplicate = 0

    print(f"[run] keywords={keywords!r} cap={effective_cap} dry_run={dry_run}")

    for keyword in keywords:
        if stored >= effective_cap:
            break
        print(f"[run] searching: {keyword!r}")
        for hit in gh.search_users(keyword):
            if stored >= effective_cap:
                break
            gh_id = hit["id"]
            if gh_id in seen_ids:
                continue
            seen_ids.add(gh_id)

            profile = gh.get_user(hit["login"])
            if profile is None:
                continue

            if not profile.get("email"):
                skipped_no_email += 1
                continue

            record = build_record(profile, keyword)

            if dry_run:
                print(f"[dry-run] would store: {record}")
                stored += 1
                continue

            outcome = upsert_contact(sb, record)
            if outcome == "duplicate_email_skipped":
                skipped_duplicate += 1
                print(f"[skip] duplicate email for {record['username']}")
            else:
                stored += 1
                print(f"[store] {record['username']} <{record['email']}>")

    print(
        f"[done] stored={stored} skipped_no_public_email={skipped_no_email} "
        f"skipped_duplicate_email={skipped_duplicate}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keywords",
        nargs="+",
        required=True,
        help="One or more GitHub user-search queries, e.g. 'location:kenya language:go'",
    )
    parser.add_argument(
        "--max-users",
        type=int,
        default=20,
        help="Stop after storing this many users (also hard-capped, see README).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be stored without touching Supabase.",
    )
    args = parser.parse_args()

    try:
        run(args.keywords, args.max_users, args.dry_run)
    except RuntimeError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
