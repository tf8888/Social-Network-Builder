// Server-only. Thin wrapper around the Resend HTTP API — no SDK dependency,
// just fetch, matching how src/lib/github.ts talks to GitHub's REST API.

const RESEND_API_BASE = "https://api.resend.com";

export interface ResendSendParams {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface ResendSendResult {
  id?: string;
  error?: string;
}

export async function resendSendEmail(params: ResendSendParams): Promise<ResendSendResult> {
  try {
    const resp = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
    const json = await resp.json().catch(() => ({}) as Record<string, unknown>);
    if (!resp.ok) {
      const message =
        (typeof json.message === "string" && json.message) ||
        (typeof json.error === "string" && json.error) ||
        `Resend API error (${resp.status})`;
      return { error: message };
    }
    return { id: typeof json.id === "string" ? json.id : undefined };
  } catch (err) {
    return { error: (err as Error).message || "network error calling Resend" };
  }
}

// Looks up the account's domains and returns the first one Resend has
// fully verified for sending — used to prefill the sender-email input. If
// the key is invalid, the request fails, or nothing is verified yet, this
// resolves to null and the UI just leaves the input free-text instead.
export async function resendGetVerifiedDomain(apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(`${RESEND_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return null;
    const json = (await resp.json().catch(() => null)) as { data?: { name?: string; status?: string }[] } | null;
    const domains = Array.isArray(json?.data) ? json!.data : [];
    const verified = domains.find((d) => d.status === "verified" && d.name);
    return verified?.name ?? null;
  } catch {
    return null;
  }
}
