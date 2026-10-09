import type { ActionEvent, RequestEvent } from './types';
import { safeUrl } from './url';

/** Human-readable phrasing shared by the UI, reasons and summaries. */

const quote = (s: string) => `“${s}”`;

function targetName(a: ActionEvent): string {
  if (!a.target) return 'the page';
  return a.target.label ? quote(a.target.label) : a.target.selector;
}

/** Title-case description for chapter headings: `Clicked “Sign in”`. */
export function describeAction(a: ActionEvent): string {
  switch (a.kind) {
    case 'navigate': {
      const url = safeUrl(a.url);
      return `Opened ${url ? url.pathname + url.search : a.url}`;
    }
    case 'click':
      return `Clicked ${targetName(a)}`;
    case 'input':
      return `Typed in ${targetName(a)}`;
    case 'submit':
      return `Submitted ${targetName(a)}`;
    case 'keypress':
      return `Pressed ${a.key ?? 'a key'} in ${targetName(a)}`;
  }
}

/** Lower-case phrase for use mid-sentence: `you clicked “Sign in”`. */
export function actionPhrase(a: ActionEvent): string {
  const d = describeAction(a);
  return `you ${d.charAt(0).toLowerCase()}${d.slice(1)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** `+00:14.1` style offset from the investigation start. */
export function formatOffset(ms: number): string {
  const clamped = Math.max(0, ms);
  const min = Math.floor(clamped / 60_000);
  const sec = (clamped % 60_000) / 1000;
  return `${String(min).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
}

export function requestDuration(e: RequestEvent): number | undefined {
  return e.endTime === undefined ? undefined : Math.max(0, e.endTime - e.time);
}

/** Short outcome label: `500`, `CORS`, `Failed`, `Pending`. */
export function requestOutcome(e: RequestEvent): string {
  if (e.failure?.kind === 'network') {
    if (e.failure.corsError) return 'CORS';
    if (e.failure.blockedReason) return 'Blocked';
    return 'Failed';
  }
  if (e.status !== undefined) return String(e.status);
  return 'Pending';
}

export function isFailedRequest(e: RequestEvent): boolean {
  return e.failure !== undefined || (e.status !== undefined && e.status >= 400);
}
