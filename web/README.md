# Web dashboard (Next.js)

Frontend + backend for the GitHub → Supabase ETL demo. Lets you trigger a
capped collection run from a form and browse results in a table, streaming
live progress from the server as each profile is processed.

This is a second, JS/TS surface on the **same** Supabase table used by the
Python CLI at the project root (`../src/main.py`) — either one can collect,
both read/write the same `github_contacts` table. Use whichever you prefer;
you don't need to run both.

## Same scoping rules as the CLI

- Only stores users with a **public** profile email (`GET /users/{login}`'s
  `email` field) — never scrapes commit metadata for emails.
- Hard-capped at 50 users per run (`src/lib/config.ts: HARD_MAX_USERS`),
  enforced server-side regardless of what's submitted in the form.
- The whole app (page + every API route) is gated behind a single shared
  `ACCESS_CODE` (`src/middleware.ts`, `src/lib/auth.ts`) — visiting without
  a valid session cookie redirects to `/login`. Set `ACCESS_CODE` before
  deploying anywhere the URL isn't private; leave it blank for local dev
  (gate is a no-op when unset, matching the app's previous no-auth behavior).
  This is a shared password, not per-user accounts — appropriate here since
  there's one shared server identity (one GitHub token, one Supabase key),
  not one per visitor.
- All Supabase access happens server-side with the **service_role** key
  (`src/lib/supabase.ts`) — it's never sent to the browser. The table also
  has RLS enabled with no anon policies (`../supabase/migrations/0002_enable_rls.sql`),
  so the publishable/anon key can't read or write it even if someone got it.

## Setup

```
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:
- `GITHUB_TOKEN` — same token as the CLI
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — service_role key, not the anon/publishable key
- `RESEND_API_KEY` — optional, only needed for the "Send email" feature
- `ACCESS_CODE` — optional locally, required before deploying publicly (see above)

The `github_contacts` and `collect_jobs` tables must already exist (see the
root README / `../supabase/migrations/`) — run all migrations through
`0006_create_collect_jobs.sql`.

## Run

```
npm run dev
```

Open http://localhost:3000. Enter one or more keywords (GitHub search
qualifiers work, e.g. `location:kenya language:go`) and a max-users count,
then **Start collection** — progress streams into a log as each profile is
checked, and the table below refreshes when it's done.

## Deploying to Vercel

This app lives in `web/` inside a larger repo (the Python CLI sits at the
root) — so if you connect the whole repo as one Vercel project, set
**Project Settings → General → Root Directory** to `web`. (If instead you
deploy with the Vercel CLI, run `vercel` from inside `web/` and it infers
this automatically.)

1. **Set environment variables** (Project Settings → Environment Variables):
   `GITHUB_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, optionally
   `RESEND_API_KEY`, and **`ACCESS_CODE`** — without it the deployed URL has
   no protection at all (see above).
2. **Run all Supabase migrations**, including `0006_create_collect_jobs.sql`
   — collect-run state (for Stop/Resume) is persisted in Supabase rather
   than in server memory specifically so it survives across serverless
   function instances; without that table `/api/collect` fails outright.
3. Deploy. Framework preset ("Next.js") and build command are auto-detected.

### Streamed collect runs on serverless

The collect/send-email endpoints are long-running streamed requests
(deliberately rate-limited against GitHub/Resend). `maxDuration` is set to
120s on the collect routes (`src/app/api/collect/route.ts`,
`.../resume/route.ts`) — this needs a Vercel plan/tier that allows function
durations above the Hobby default; lower it if you're on a plan that caps
lower. If a run does get cut off mid-stream (timeout, cold start eviction,
client tab closed), it degrades gracefully:
- Every stored contact is written to Supabase immediately, not batched at
  the end, so nothing already found is lost.
- Job progress (which keyword/page it was on, which GitHub ids it's already
  seen) is persisted after each candidate (`src/lib/jobs.ts`), so **Resume**
  picks back up close to where the run left off, from any instance.
- **Stop** works the same way — it flips a flag on the persisted job row,
  and whichever instance is actually running the loop notices on its next
  poll and winds down cleanly.
