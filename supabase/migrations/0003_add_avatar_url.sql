-- Add avatar_url, already returned by GET /users/{username} (GitHub's
-- public profile picture), purely for a nicer dashboard UI.
alter table public.github_contacts add column if not exists avatar_url text;
