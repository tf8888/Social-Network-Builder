"""
Local read-only dashboard for the collected github_contacts table.

Uses the Supabase service_role key server-side only -- the key never
reaches the browser. This table holds scraped personal emails, so if you
ever deploy this app publicly, keep the Supabase calls server-side and put
real auth in front of the dashboard itself; don't move this to client-side
JS with the anon key.

Run:
    python -m src.webapp
Then open http://127.0.0.1:5000
"""

from flask import Flask, render_template, request

from src.config import load_settings
from src.supabase_client import make_client

TABLE = "github_contacts"
PAGE_SIZE = 25

app = Flask(__name__)
_settings = load_settings()
_client = make_client(_settings.supabase_url, _settings.supabase_service_key)


def _country_breakdown() -> list[tuple[str, int]]:
    rows = _client.table(TABLE).select("country").execute().data or []
    counts: dict[str, int] = {}
    for row in rows:
        key = row.get("country") or "Unknown"
        counts[key] = counts.get(key, 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])[:8]


@app.route("/")
def index():
    q = request.args.get("q", "").strip()
    country = request.args.get("country", "").strip()
    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1
    offset = (page - 1) * PAGE_SIZE

    query = _client.table(TABLE).select("*", count="exact")
    if q:
        escaped = q.replace(",", "")
        query = query.or_(
            f"username.ilike.%{escaped}%,name.ilike.%{escaped}%,email.ilike.%{escaped}%"
        )
    if country:
        query = query.ilike("country", f"%{country}%")

    result = (
        query.order("collected_at", desc=True)
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    rows = result.data or []
    total_matching = result.count or 0
    total_pages = max(1, -(-total_matching // PAGE_SIZE))

    total_all = _client.table(TABLE).select("id", count="exact").execute().count or 0

    return render_template(
        "index.html",
        rows=rows,
        q=q,
        country=country,
        page=page,
        total_pages=total_pages,
        total_matching=total_matching,
        total_all=total_all,
        top_countries=_country_breakdown(),
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
