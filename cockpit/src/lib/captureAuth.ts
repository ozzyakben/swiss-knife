import { timingSafeEqual } from "node:crypto";

// Shared auth for the token-gated, headless endpoints (quick-capture + routine
// runner). The token is delivered via the `x-capture-token` HEADER only — the
// documented macOS Shortcut recipe uses the header, and a header (unlike a
// `?token=` query param) does not leak into access/proxy logs or browser
// history. Comparison is constant-time so a stolen-token guess can't be timed.
export function readCaptureToken(req: Request): string | null {
  return req.headers.get("x-capture-token");
}

export function tokenMatches(provided: string | null, configured: string): boolean {
  if (!provided || !configured) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  // timingSafeEqual requires equal lengths; an unequal length is a non-match,
  // and length is not secret, so the early return doesn't leak anything useful.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
