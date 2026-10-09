/** Small, dependency-free URL helpers used across the analysis layer. */

export function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Approximates the "site" (registrable domain) of a URL: the last two labels of
 * the hostname, or the whole host for IPs, localhost and single-label hosts.
 *
 * This deliberately avoids shipping the Public Suffix List. It is wrong for
 * hosts like `foo.co.uk` (yields `co.uk`), which only makes first-party
 * detection slightly too generous. A PSL-backed version can replace it later.
 */
export function siteOf(raw: string): string | null {
  const url = safeUrl(raw);
  if (!url || !url.hostname) return null;
  const host = url.hostname.toLowerCase();
  if (IPV4.test(host) || host.includes(':') || !host.includes('.')) return host;
  return host.split('.').slice(-2).join('.');
}

/** True when both URLs belong to the same site. Unknown URLs are never first-party. */
export function isSameSite(a: string, b: string): boolean {
  const sa = siteOf(a);
  return sa !== null && sa === siteOf(b);
}

/** `POST /api/v2/login` for first-party, `GET cdn.example.com/x.js` for third-party. */
export function shortRequestLabel(method: string, raw: string, pageUrl: string): string {
  return `${method} ${shortUrl(raw, pageUrl)}`;
}

export function shortUrl(raw: string, pageUrl: string): string {
  const url = safeUrl(raw);
  if (!url) return raw;
  if (url.protocol === 'data:') return 'data: URL';
  const path = url.pathname + url.search;
  return isSameSite(raw, pageUrl) && safeUrl(pageUrl)?.host === url.host ? path : url.host + path;
}

/** The last path segment of a script URL plus line, e.g. `auth.ts:42`. */
export function shortLocation(raw: string, line?: number): string {
  const url = safeUrl(raw);
  const file = url ? url.pathname.split('/').filter(Boolean).pop() || url.host : raw;
  return line === undefined ? file : `${file}:${line}`;
}
