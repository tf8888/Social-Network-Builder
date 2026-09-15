-- github_contacts: demo table for a portfolio ETL project.
-- Stores ONLY the profile fields GitHub's public API already exposes
-- (email is null unless the user opted to make it public on their profile).

create table if not exists public.github_contacts (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null,
  username text not null,
  name text,
  email text,
  country text,                 -- from profile "location" (free text, not validated/geocoded)
  portfolio_url text,           -- from profile "blog"
  company text,
  bio text,
  public_repos integer,
  followers integer,
  following integer,
  account_created_at timestamptz,
  github_experience_years numeric,   -- derived: years since account_created_at, at collection time
  search_keyword text,          -- which search query surfaced this user, for traceability
  collected_at timestamptz not null default now(),

  constraint github_contacts_github_id_key unique (github_id)
);

-- Prevent storing the same email twice under different github_ids.
create unique index if not exists github_contacts_email_unique_idx
  on public.github_contacts (lower(email))
  where email is not null;

create index if not exists github_contacts_username_idx
  on public.github_contacts (username);

comment on table public.github_contacts is
  'Portfolio ETL demo. Only public, self-disclosed profile emails are collected — never scraped from commit metadata. Volume is capped by the collector script. See project README for the GitHub ToS caveat this table exists under.';
