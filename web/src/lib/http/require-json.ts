// CSRF defense-in-depth for cookie/session-authenticated, state-changing POST routes.
//
// These routes authenticate via the ambient Supabase session cookie, which the browser auto-attaches
// to ANY request to our origin — including a cross-site <form> auto-submitted from an attacker page
// (classic CSRF). A cross-site HTML form can only send Content-Type x-www-form-urlencoded /
// multipart/form-data / text/plain; it CANNOT send application/json without a CORS preflight (which
// same-origin policy then blocks). So requiring application/json forces any cross-origin caller into
// a preflighted fetch that the browser refuses — closing the CSRF vector.
//
// This is the EXPLICIT second lock. The first is the session cookie's SameSite=Lax (the @supabase/ssr
// default), which already withholds the cookie on cross-site POSTs. We don't want to depend solely on
// a library default we don't control: a future upgrade, or anyone setting SameSite=None for an embed,
// would silently remove it. This guard lives in our own code and fails closed.
//
// Returns a 415 NextResponse when the Content-Type is not application/json, else null (proceed).
// Routes authed by a Bearer token (sync) or a cron signature are NOT CSRF-able (no ambient
// credential) and don't need this.
import { NextResponse, type NextRequest } from "next/server";

export function requireJsonContentType(request: NextRequest): NextResponse | null {
  // Content-Type may carry params (e.g. "application/json; charset=utf-8") — match only the media type.
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  return null;
}
