import type { ConsoleEvent, RequestEvent, TrailEvent } from './types';
import { safeUrl } from './url';

/**
 * Known noise: things that show up in almost every session and are rarely the
 * bug. Matching events are still recorded and shown on demand, but ranked low
 * and collapsed by default. Each rule explains itself so the UI can say why.
 *
 * Contributions welcome: add a rule with a test in `noise.test.ts`.
 */
export interface NoiseRule {
  id: string;
  reason: string;
  match: (e: TrailEvent) => boolean;
}

const requestRule = (id: string, reason: string, match: (e: RequestEvent) => boolean): NoiseRule => ({
  id,
  reason,
  match: (e) => e.type === 'request' && match(e),
});

const consoleRule = (id: string, reason: string, match: (e: ConsoleEvent) => boolean): NoiseRule => ({
  id,
  reason,
  match: (e) => e.type === 'console' && match(e),
});

const pathOf = (raw: string) => safeUrl(raw)?.pathname ?? raw;

export const NOISE_RULES: NoiseRule[] = [
  requestRule('favicon', 'Missing favicon', (e) => /\/favicon\.ico$/i.test(pathOf(e.url)) && (e.status ?? 0) >= 400),
  requestRule('sourcemap', 'Missing source map (dev tooling only)', (e) => /\.map$/i.test(pathOf(e.url))),
  requestRule(
    'blocked-by-client',
    'Blocked by an ad or tracker blocker in this browser',
    (e) => e.failure?.kind === 'network' && /ERR_BLOCKED_BY_CLIENT/.test(e.failure.errorText),
  ),
  requestRule(
    'aborted',
    'Cancelled by the page (navigation or aborted fetch)',
    (e) => e.failure?.kind === 'network' && /ERR_ABORTED/.test(e.failure.errorText),
  ),
  consoleRule('react-devtools', 'React DevTools install hint', (e) => /Download the React DevTools/i.test(e.text)),
  consoleRule('react-key', 'React development-only warning about list keys', (e) =>
    /unique ["“]?key["”]? prop/i.test(e.text),
  ),
  consoleRule('sourcemap-warning', 'Source map could not be loaded (dev tooling only)', (e) =>
    /(failed to load source ?map|source map error)/i.test(e.text),
  ),
  consoleRule('hmr', 'Dev-server hot reload message', (e) => /^\s*\[(vite|HMR|webpack-dev-server)\]/i.test(e.text)),
  consoleRule('extension', 'Comes from a browser extension, not the page', (e) =>
    (e.stack ?? []).some((f) => /^(chrome|moz)-extension:/.test(f.url)),
  ),
];

/** Returns the first matching noise rule, if any. */
export function matchNoise(e: TrailEvent, rules: NoiseRule[] = NOISE_RULES): NoiseRule | undefined {
  return rules.find((r) => r.match(e));
}
