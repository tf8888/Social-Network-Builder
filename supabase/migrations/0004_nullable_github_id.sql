-- Allow manually-added contacts (created from the dashboard's "New user"
-- form) that aren't tied to a real GitHub account. The existing unique
-- constraint on github_id is untouched -- Postgres treats each NULL as
-- distinct, so any number of manual rows can coexist with github_id NULL
-- while scraped rows still can't collide on github_id.
alter table public.github_contacts alter column github_id drop not null;
