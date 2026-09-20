// Redirect-URI allowlist for Alexa account linking.
// Alexa rotates its redirect hosts, so its known domains are always allowed and
// extra hosts can be added through PIHUB_OAUTH_REDIRECT_URIS (comma separated).

const ALEXA_HOSTS =
  /(^|\.)(amazon\.com|amazon\.co\.jp|amazonalexa\.com|pitangui\.amazon\.com|layla\.amazon\.com)$/;

export function isRedirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const extra = (process.env.PIHUB_OAUTH_REDIRECT_URIS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.some((allowed) => uri === allowed || uri.startsWith(allowed))) return true;
  return ALEXA_HOSTS.test(u.hostname);
}
