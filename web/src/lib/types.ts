export type EmailStatus = "not_sent" | "sent" | "failed";

export interface Contact {
  id: string;
  github_id: number | null;
  username: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  country: string | null;
  portfolio_url: string | null;
  company: string | null;
  bio: string | null;
  public_repos: number | null;
  followers: number | null;
  following: number | null;
  account_created_at: string | null;
  github_experience_years: number | null;
  search_keyword: string | null;
  collected_at: string;
  email_status: EmailStatus;
  email_sent_at: string | null;
  email_error: string | null;
}

export interface ContactsResponse {
  rows: Contact[];
  page: number;
  totalMatching: number;
  totalPages: number;
  totalAll: number;
  topCountries: [string, number][];
}

export type CollectEvent =
  | { type: "start"; jobId: string; keywords: string[]; cap: number }
  | { type: "resumed"; jobId: string; stored: number; cap: number }
  | { type: "searching"; keyword: string }
  | { type: "stored"; username: string; email: string }
  | { type: "skip_no_email"; username: string }
  | { type: "skip_duplicate_email"; username: string }
  | { type: "stopped"; stored: number }
  | { type: "done"; stored: number; skippedNoEmail: number; skippedDuplicate: number }
  | { type: "error"; message: string };

export type SendEmailEvent =
  | { type: "start"; total: number }
  | { type: "sent"; username: string; email: string }
  | { type: "failed"; username: string; email: string; error: string }
  | { type: "stopped"; sent: number; failed: number }
  | { type: "done"; sent: number; failed: number }
  | { type: "error"; message: string };

export interface NewContactInput {
  username: string;
  name?: string | null;
  email?: string | null;
  country?: string | null;
  portfolio_url?: string | null;
  company?: string | null;
  bio?: string | null;
}
