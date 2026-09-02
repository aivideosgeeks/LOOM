import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "crm_token";
const PUBLIC_PATHS = new Set(["/login", "/setup"]);
/** Invitation links carry their own one-time token, so they are reachable signed out. */
const PUBLIC_PREFIXES = ["/invite/"];

/**
 * Lightweight gate: redirects to /login when the auth cookie is absent. The API verifies the
 * JWT on every request, so this only avoids rendering app screens for signed-out visitors.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api")) return NextResponse.next();
  const signedIn = request.cookies.has(AUTH_COOKIE);
  const isPublic = PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/login" || pathname === "/setup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)).*)"],
};
