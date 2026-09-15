// Shared-secret access gate. Deliberately simple (one env var, one cookie)
// rather than a full auth system — this app has a single shared server
// identity (one GitHub token, one Supabase service key), not per-user
// accounts, so a shared password is an appropriate amount of protection
// for "don't let a stranger who finds the URL run jobs on my credentials".
//
// The gate is entirely optional: if ACCESS_CODE isn't set, middleware.ts
// lets every request through unchanged (matches local-dev behavior before
// this existed). Set it before deploying somewhere the URL isn't private.

export const ACCESS_COOKIE_NAME = "gh_access";

export function getAccessCode(): string | null {
  return process.env.ACCESS_CODE?.trim() || null;
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto (crypto.subtle) instead of Node's `crypto` module so this
  // also works if middleware ever runs on the Edge runtime.
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The cookie stores a hash of the access code, not the code itself, so a
// leaked cookie value (logs, browser devtools) doesn't hand over the
// actual shared secret.
export async function cookieValueFor(code: string): Promise<string> {
  return sha256Hex(code);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
