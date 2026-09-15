import { NextRequest } from "next/server";
import { ACCESS_COOKIE_NAME, cookieValueFor, getAccessCode, timingSafeEqual } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const code = getAccessCode();
  if (!code) {
    // Gate isn't configured server-side — nothing to log into.
    return Response.json({ ok: true });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.code !== "string" || !timingSafeEqual(body.code, code)) {
    return Response.json({ error: "incorrect access code" }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    [
      `${ACCESS_COOKIE_NAME}=${await cookieValueFor(code)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${60 * 60 * 24 * 30}`,
      ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
    ].join("; ")
  );
  return res;
}
