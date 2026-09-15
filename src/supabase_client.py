"""Supabase write layer. Uses the service_role key -- writes bypass RLS."""

from typing import Optional

from supabase import Client, create_client

TABLE = "github_contacts"


def make_client(url: str, service_key: str) -> Client:
    return create_client(url, service_key)


def upsert_contact(client: Client, record: dict) -> str:
    """
    Upsert by github_id so re-running the collector never creates duplicate
    rows for the same account. Returns 'inserted', 'updated_or_noop', or
    'duplicate_email_skipped'.
    """
    try:
        client.table(TABLE).upsert(record, on_conflict="github_id").execute()
        return "upserted"
    except Exception as exc:  # noqa: BLE001 - surface, but keep the run going
        # The partial unique index on lower(email) raises here when a
        # different github_id already owns that email.
        msg = str(exc)
        if "github_contacts_email_unique_idx" in msg or "duplicate key" in msg:
            return "duplicate_email_skipped"
        raise


def get_by_github_id(client: Client, github_id: int) -> Optional[dict]:
    res = client.table(TABLE).select("id").eq("github_id", github_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None
