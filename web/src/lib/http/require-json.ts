// Require application/json on cookie-authed POSTs as a CSRF guard: a cross-site HTML form can't send
// that content type without a preflight the browser blocks. Returns a 415 response, or null to proceed.
import { NextResponse, type NextRequest } from "next/server";

export function requireJsonContentType(request: NextRequest): NextResponse | null {
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  return null;
}
