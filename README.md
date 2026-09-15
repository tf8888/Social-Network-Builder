# GitHub → Supabase Contact ETL (portfolio demo)

A small ETL pipeline: search GitHub users by keyword, pull their public
profile, and store it in Supabase. Built to demonstrate pipeline design
(rate limiting, backoff, dedup, upsert) — **not** meant to run at scale.

Two surfaces share the same Supabase table:
- **This CLI** (Python) — `python -m src.main --keywords ... --max-users ...`
- **[web/](web/)** (Next.js) — a form + streaming progress log + browsable
  table, see [web/README.md](web/README.md) for setup and for deploying it
  to Vercel. Same scoping rules (public-email-only, hard-capped volume)
  enforced server-side.

## Scope, and why it's capped

GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
prohibit using scraped/API data "for spamming purposes, including for the
purposes of sending unsolicited emails to users or selling personal
information, such as to recruiters, headhunters, and job boards." A
GitHub-user-to-email pipeline is exactly the shape of tool that clause is
about, so this project is deliberately scoped to stay a demo rather than a
usable harvesting tool:

- **Only public, self-disclosed emails.** It reads the `email` field from
  `GET /users/{username}` — which is `null` unless the user chose to make
  it public on their profile. It never scrapes commit metadata to recover
  emails users didn't choose to publish (that data source, while technically
  reachable, is the more invasive path and is not implemented here).
- **Hard volume cap.** `MAX_USERS` in `.env` is clamped to 100 in code
  (`src/config.py: HARD_MAX_USERS`) — not just a suggested default. Raising
  it requires editing the source, not just the env var.
- **One-shot CLI run.** No scheduler, no daemon, no continuous crawling.
- **No storage without an email.** Users with no public email are skipped
  entirely and never written to the DB.
- **Do not use this to build outreach/recruiting lists.** That's the use
  case the ToS clause above targets.

## Setup

1. **Python deps**
   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **GitHub token** — create a classic token with no scopes (public data
   only) at https://github.com/settings/tokens. Authenticated requests get
   5000/hr on the core API instead of 60/hr, and the Search API works
   reliably.

3. **Supabase table** — run all migrations in `supabase/migrations/` (in
   order) via the Supabase SQL editor, or:
   ```
   supabase login
   supabase link --project-ref tjqgzzdjcghystovcdtb
   supabase db push
   ```

4. **Supabase key** — you need the **service_role** key to write rows
   (Project Settings → API → `service_role` secret), not the
   publishable/anon key you shared earlier — the anon key can't insert
   unless you add RLS policies permitting it. Never commit this key.

5. **Configure**
   ```
   copy .env.example .env
   ```
   Fill in `GITHUB_TOKEN`, `SUPABASE_SERVICE_KEY`.

## Run

```
python -m src.main --keywords "location:portland language:python" --max-users 15 --dry-run
python -m src.main --keywords "location:brazil" "topic:machine-learning" --max-users 25
```

`--dry-run` prints what would be stored without touching Supabase.

## How the three stated risks are handled

- **Scraping takes time / GitHub can block it** — authenticated requests,
  separate delays for the Search API (tighter limit, ~30/min) and core API,
  and automatic backoff on `403`/`429`/`5xx` using GitHub's `Retry-After` /
  `X-RateLimit-Reset` headers.
- **Duplicate emails** — `github_id` is unique in the DB (upsert on
  conflict, so re-running never duplicates a user), and a partial unique
  index on `lower(email)` rejects a second github_id claiming an email
  already stored under another account.

## Schema

See `supabase/migrations/0001_create_github_contacts.sql` for
`github_contacts`: github_id, username, name, email, country (from
`location`), portfolio_url (from `blog`), company, bio, public_repos,
followers, following, account_created_at, github_experience_years
(derived), search_keyword, collected_at.
