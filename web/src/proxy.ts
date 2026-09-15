import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, cookieValueFor, getAccessCode, timingSafeEqual } from "@/lib/auth";

// Gates the whole app (page + API routes) behind a shared access code —
// see src/lib/auth.ts for why this shape of auth. No-op if ACCESS_CODE
// isn't configured.
export async function proxy(req: NextRequest) {
  const code = getAccessCode();
  if (!code) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const expected = await cookieValueFor(code);
  if (cookie && timingSafeEqual(cookie, expected)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized — log in at /login" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
