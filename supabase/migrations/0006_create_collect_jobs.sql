-- collect_jobs: server-side state for the web dashboard's collect runs
-- (start/stop/resume), persisted here instead of in-process memory so it
-- survives across serverless function instances on platforms like Vercel,
-- where a stop/resume request has no guarantee of landing on the same
-- instance that started the run.

create table if not exists public.collect_jobs (
  id uuid primary key default gen_random_uuid(),
  keywords text[] not null,
  cap integer not null,
  seen_ids bigint[] not null default '{}',
  stored integer not null default 0,
  skipped_no_email integer not null default 0,
  skipped_duplicate integer not null default 0,
  keyword_index integer not null default 0,
  search_page integer not null default 1,
  status text not null default 'running'
    check (status in ('running', 'stopped', 'done', 'error')),
  stop_requested boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collect_jobs_updated_at_idx
  on public.collect_jobs (updated_at);

-- Same lockdown as github_contacts: only the server-side service_role key
-- (never shipped to the browser) reads/writes this table.
alter table public.collect_jobs enable row level security;

comment on table public.collect_jobs is
  'Persisted state for web dashboard collect runs, so Stop/Resume work across serverless function instances. Rows older than a day are swept opportunistically when a new job is created.';
