import { redactBody, redactHeaders, redactUrl } from './redact';
import type { RequestEvent } from './types';

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Headers the browser sets itself; replaying them with curl only adds noise. */
const SKIP = new Set(['host', 'content-length', 'connection', 'accept-encoding']);
const isPseudo = (k: string) => k.startsWith(':') || k.startsWith('sec-');

/** A curl command reproducing the request, with secrets redacted. */
export function toCurl(req: RequestEvent): string {
  const parts = [`curl ${shellQuote(redactUrl(req.url))}`];
  if (req.method !== 'GET') parts.push(`-X ${req.method}`);
  for (const [k, v] of Object.entries(redactHeaders(req.requestHeaders) ?? {})) {
    if (SKIP.has(k) || isPseudo(k)) continue;
    parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }
  if (req.postData) parts.push(`--data-raw ${shellQuote(redactBody(req.postData) ?? '')}`);
  return parts.join(' \\\n  ');
}
