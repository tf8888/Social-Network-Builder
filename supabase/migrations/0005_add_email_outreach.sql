-- Track Resend email outreach status per contact.
--
-- email_status starts 'not_sent' for every existing row (the default) and
-- every newly-collected one; the /api/email/send route flips it to 'sent'
-- or 'failed' as each attempt completes, recording a timestamp or error
-- alongside. Kept as `text` + a check constraint rather than a Postgres
-- enum, matching how the rest of this table treats classification fields
-- (see country/company above).

alter table public.github_contacts
  add column if not exists email_status text not null default 'not_sent',
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text;

alter table public.github_contacts
  add constraint github_contacts_email_status_check
  check (email_status in ('not_sent', 'sent', 'failed'));

create index if not exists github_contacts_email_status_idx
  on public.github_contacts (email_status);
