import { describe, it, expect } from "vitest";
import { isLocalEngineUrl } from "@/lib/engineUrl";

// SSRF / local-only gate: prompts are fetched from this URL server-side, so the
// allowlist must accept only local hosts and reject anything that could route
// off-machine. A regression to substring/suffix matching would re-open the hole.
describe("isLocalEngineUrl", () => {
  it("accepts the local engine hosts", () => {
    expect(isLocalEngineUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalEngineUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalEngineUrl("http://host.docker.internal:11434/v1")).toBe(true);
    expect(isLocalEngineUrl("http://[::1]:11434/v1")).toBe(true);
  });
  it("rejects off-machine hosts", () => {
    expect(isLocalEngineUrl("http://evil.example.com/v1")).toBe(false);
    expect(isLocalEngineUrl("http://169.254.169.254/v1")).toBe(false);
  });
  it("rejects suffix/substring tricks (exact host match only)", () => {
    expect(isLocalEngineUrl("http://localhost.evil.com/v1")).toBe(false);
    expect(isLocalEngineUrl("http://127.0.0.1.evil.com/v1")).toBe(false);
  });
  it("rejects userinfo that hides a foreign host", () => {
    // hostname is evil.com here; the localhost@ is userinfo, not the host
    expect(isLocalEngineUrl("http://localhost@evil.com/v1")).toBe(false);
  });
  it("rejects non-http(s) protocols", () => {
    expect(isLocalEngineUrl("file:///etc/passwd")).toBe(false);
    expect(isLocalEngineUrl("gopher://localhost/")).toBe(false);
  });
  it("rejects unparseable values", () => {
    expect(isLocalEngineUrl("not a url")).toBe(false);
    expect(isLocalEngineUrl("")).toBe(false);
  });
});
