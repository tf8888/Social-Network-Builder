-- Lock down github_contacts.
--
-- Without RLS, Supabase's default grants let the anon/publishable key read
-- AND write this table over the REST API -- and this table holds scraped
-- personal emails. Enabling RLS with no policies denies anon/authenticated
-- entirely; only the service_role key (used server-side by the collector
-- and the dashboard, never shipped to a browser) can still read/write,
-- since service_role bypasses RLS by design.

alter table public.github_contacts enable row level security;

-- No policies added on purpose: default-deny for anon/authenticated.
-- If you later want a public read-only view, add a narrow SELECT policy
-- (or better, a view that excludes the email column) rather than opening
-- this table itself.
