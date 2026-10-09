/**
 * Redaction runs before anything leaves the browser (copy, export, report).
 * Captured data stays local and unredacted so the person debugging sees the
 * real values; whatever they share has secrets replaced with `[redacted]`.
 */

export const REDACTED = '[redacted]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

// Anchored where a bare substring would over-match (`author`, `spinner`, `cardinality`).
const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|api[-_]?key|^auth$|authorization|session|cookie|^otp$|^pin$|ssn|credit[-_]?card|card[-_]?number|^cvc$|^cvv$|signature)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) || isSensitiveKey(k) ? REDACTED : v;
  }
  return out;
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = isSensitiveKey(k) ? REDACTED : redactJsonValue(v);
    return out;
  }
  return value;
}

/** Redacts sensitive query parameters, keeping the rest of the URL intact. */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveKey(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    changed = true;
  }
  return changed ? url.toString() : raw;
}

/** Redacts a request or response body: JSON and form-encoded bodies key by key, anything else untouched. */
export function redactBody(body: string | undefined): string | undefined {
  if (!body) return body;
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(trimmed)), null, 2);
    } catch {
      // Not valid JSON (possibly truncated); fall through to the text rules.
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    const params = new URLSearchParams(trimmed);
    for (const key of [...params.keys()]) if (isSensitiveKey(key)) params.set(key, REDACTED);
    return params.toString();
  }
  // Last resort for text: mask obvious `"key": "value"` / `key=value` pairs.
  return body.replace(/(["']?)([A-Za-z0-9_-]+)\1(\s*[:=]\s*)(["']?)([^"'&,\s}]+)\4/g, (m, q, key, sep, vq) =>
    isSensitiveKey(key) ? `${q}${key}${q}${sep}${vq}${REDACTED}${vq}` : m,
  );
}
