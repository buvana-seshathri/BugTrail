import type { ConsoleEvent, RequestEvent, TrailEvent } from './types';
import { safeUrl } from './url';

/**
 * Fingerprints decide which events are "the same problem" so that 38 copies of
 * one warning become a single row. Two events with equal fingerprints are
 * grouped; muting works on fingerprints too.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;
const URLISH = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi;
const NUMBER = /\b\d+(\.\d+)?\b/g;

/** Strips the parts of a message that vary between otherwise identical occurrences. */
export function normalizeMessage(text: string): string {
  return text
    .replace(URLISH, '<url>')
    .replace(UUID, '<uuid>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Replaces id-like path segments so `/users/123` and `/users/456` group together. */
export function normalizePath(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw;
  const path = url.pathname
    .split('/')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return ':n';
      if (UUID_SEGMENT.test(seg) || /^[0-9a-f]{12,}$/i.test(seg)) return ':id';
      return seg;
    })
    .join('/');
  return `${url.host}${path}`;
}

function requestOutcome(e: RequestEvent): string {
  if (e.failure?.kind === 'network') return e.failure.corsError ? 'cors' : e.failure.errorText;
  if (e.status !== undefined) return String(e.status);
  return 'pending';
}

export function fingerprintRequest(e: RequestEvent): string {
  return `req|${e.method}|${normalizePath(e.url)}|${requestOutcome(e)}`;
}

export function fingerprintConsole(e: ConsoleEvent): string {
  const top = e.stack?.[0];
  const where = top ? `${top.url}:${top.line}` : (e.url ?? '');
  return `con|${e.level}|${normalizeMessage(e.text)}|${where}`;
}

export function fingerprint(e: TrailEvent): string {
  switch (e.type) {
    case 'request':
      return fingerprintRequest(e);
    case 'console':
      return fingerprintConsole(e);
    case 'action':
      return `act|${e.kind}|${e.target?.selector ?? e.url}`;
  }
}
