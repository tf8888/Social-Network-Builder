// Server-only config. Never import this from a "use client" component —
// it reads secrets that must not reach the browser bundle.

// Intentional hard ceiling, smaller than the CLI's (100): this runs inside
// a single HTTP request/stream, so it needs to finish in a reasonable time.
// Not configurable via env var on purpose — raise it in code if you truly
// need to, don't just bump a request param.
export const HARD_MAX_USERS = 50;

export interface ServerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

// NOTE: there is no access-code gate on /api/collect anymore (removed by
// request). That means anyone who can load this app can trigger a
// collection run — using their own GitHub token, submitted per-request —
// and write to its Supabase table. Fine for local-only use — do NOT deploy
// this publicly without putting a real auth layer in front of it first.
export function getServerConfig(): ServerConfig {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. Use the service_role key — " +
        "never prefix it with NEXT_PUBLIC_, that would ship it to the browser."
    );
  }

  return { supabaseUrl, supabaseServiceKey };
}

// GitHub token is no longer a server secret — the user pastes their own
// personal access token into the collect form on every run, and it's used
// only to build that run's GithubClient. Nothing persists it (not even the
// collect_jobs row), so Resume needs the token supplied again too.
export function requireGithubToken(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) {
    throw new Error("GitHub token is required — paste a personal access token to collect contacts.");
  }
  return token;
}

export function clampMaxUsers(requested: number): number {
  if (!Number.isFinite(requested) || requested < 1) return 10;
  return Math.min(Math.trunc(requested), HARD_MAX_USERS);
}

// Email outreach (Resend). Optional on purpose — unlike GitHub/Supabase,
// the rest of the app works fine without it; only the send-email routes
// need it, and they check for it themselves.
export const EMAIL_HARD_MAX_RECIPIENTS = 100;

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

// AI email drafting (Gemini). Optional, same pattern as Resend above — only
// the generate-draft route needs it, and it checks for it itself.
export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}
