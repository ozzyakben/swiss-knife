// The engine must stay on this machine (hard rule: no cloud LLM calls). The base
// URL is fetched server-side for every generation, so an arbitrary host here is
// both an SSRF vector and a silent data-exfiltration path. Restrict it to the
// local loopback / the Docker host bridge. Exact-host allowlist (not a substring
// or suffix match) so `localhost.evil.com` / `127.0.0.1.evil.com` are rejected.
const ALLOWED_ENGINE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "host.docker.internal",
]);

export function isLocalEngineUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    return ALLOWED_ENGINE_HOSTS.has(host);
  } catch {
    return false;
  }
}
