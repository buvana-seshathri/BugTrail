import {
  actionPhrase,
  describeAction,
  formatDuration,
  isFailedRequest,
  requestDuration,
  requestOutcome,
} from './describe';
import { fingerprint, normalizePath } from './fingerprint';
import { matchNoise, NOISE_RULES, type NoiseRule } from './noise';
import type { ActionEvent, ConsoleEvent, Investigation, RequestEvent, TrailEvent } from './types';
import { isSameSite, shortLocation, shortRequestLabel } from './url';

/**
 * Turns a flat list of captured events into what the UI shows:
 *  - **issues**: grouped, ranked problems, each with the reasons for its score;
 *  - **chapters**: the story, one chapter per user action, with the problems it caused;
 *  - **summary**: one plain-language sentence about the most likely cause.
 *
 * Pure function of its input, so the same investigation always produces the
 * same analysis (and tests can pin the behaviour down).
 */

export type IssueKind = 'request' | 'error' | 'slow' | 'warning';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Reason {
  points: number;
  text: string;
}

export interface Issue {
  /** Stable id: the group fingerprint. */
  id: string;
  kind: IssueKind;
  title: string;
  /** Short badge text: `500`, `auth.ts:42`, `2.4 s`. */
  tag: string;
  occurrences: TrailEvent[];
  count: number;
  /** Time of the first occurrence. */
  time: number;
  score: number;
  severity: Severity;
  reasons: Reason[];
  /** Why this is considered noise, if it is. */
  noise?: string;
  muted: boolean;
  firstParty: boolean | null;
  /** The user action shortly before the first occurrence, if any. */
  trigger?: ActionEvent;
  triggerGapMs?: number;
  /** Id of the issue that most likely caused this one. */
  causedBy?: string;
  /** Ids of issues this one most likely caused. */
  causes: string[];
}

export interface StoryRow {
  issueId: string;
  /** Occurrences of this issue within the chapter. */
  countInChapter: number;
  /** Drawn indented under the row of the issue that caused it. */
  indent: boolean;
}

export interface Chapter {
  id: string;
  /** Undefined for activity before the first recorded action. */
  action?: ActionEvent;
  title: string;
  time: number;
  rows: StoryRow[];
  /** Successful requests in this chapter (hidden by default). */
  passedRequests: number;
  /** Info/log/debug console messages in this chapter (hidden by default). */
  quietMessages: number;
}

export interface AnalysisCounts {
  requests: number;
  passed: number;
  failed: number;
  slow: number;
  errors: number;
  warnings: number;
  noise: number;
  muted: number;
}

export interface Analysis {
  /** Visible issues, highest score first (noise included, muted excluded). */
  issues: Issue[];
  issuesById: Record<string, Issue>;
  chapters: Chapter[];
  counts: AnalysisCounts;
  summary: string | null;
  medianRequestMs?: number;
  slowThresholdMs: number;
}

export interface AnalysisOptions {
  /** A request is slow if it takes at least `max(slowMinMs, median × slowMedianFactor)`… */
  slowMinMs: number;
  slowMedianFactor: number;
  /** …or at least this long regardless of the median. */
  slowAbsoluteMs: number;
  /** Successful requests needed before the median is trusted; below this, `slowMinMs` applies. */
  slowMinSamples: number;
  /** An action "triggered" an event if the event follows within this window. */
  triggerWindowMs: number;
  /** An error is linked to a failed request that finished within this window before it. */
  causalWindowMs: number;
  noiseRules: NoiseRule[];
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  slowMinMs: 1000,
  slowMedianFactor: 4,
  slowAbsoluteMs: 3000,
  slowMinSamples: 5,
  triggerWindowMs: 2000,
  causalWindowMs: 2000,
  noiseRules: NOISE_RULES,
};

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clampScore(reasons: Reason[]): number {
  return Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, r) => sum + r.points, 0),
    ),
  );
}

function severityOf(score: number): Severity {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function consoleLocation(e: ConsoleEvent): string | undefined {
  const top = e.stack?.[0];
  return top ? shortLocation(top.url, top.line) : undefined;
}

function firstLine(text: string, max = 160): string {
  const line = text.split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

interface Classified {
  kind: IssueKind;
  key: string;
}

/** Decides whether an event is a problem, and which group it belongs to. */
function classify(e: TrailEvent, slowThresholdMs: number): Classified | null {
  if (e.type === 'request') {
    if (isFailedRequest(e)) return { kind: 'request', key: fingerprint(e) };
    const d = requestDuration(e);
    if (d !== undefined && d >= slowThresholdMs) {
      return { kind: 'slow', key: `slow|${e.method}|${normalizePath(e.url)}` };
    }
    return null;
  }
  if (e.type === 'console') {
    if (e.level === 'error') return { kind: 'error', key: fingerprint(e) };
    if (e.level === 'warning') return { kind: 'warning', key: fingerprint(e) };
  }
  return null;
}

function eventSourceUrl(e: TrailEvent): string | undefined {
  if (e.type === 'request') return e.url;
  if (e.type === 'console') return e.stack?.[0]?.url || e.url;
  return undefined;
}

/** Collapses a run of `input` actions on the same field into the first one. */
function isContinuation(prev: ActionEvent | undefined, a: ActionEvent): boolean {
  return !!prev && prev.kind === 'input' && a.kind === 'input' && prev.target?.selector === a.target?.selector;
}

export function analyze(inv: Investigation, opts: Partial<AnalysisOptions> = {}): Analysis {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const events = [...inv.events].sort((a, b) => a.time - b.time);
  const muted = new Set(inv.mutedFingerprints);

  const requests = events.filter((e): e is RequestEvent => e.type === 'request');
  const durations = requests
    .filter((r) => !isFailedRequest(r))
    .map(requestDuration)
    .filter((d): d is number => d !== undefined);
  const rawMedian = median(durations);
  // Only quote the median once there are enough samples for it to mean something.
  const medianRequestMs = durations.length >= o.slowMinSamples ? rawMedian : undefined;
  // A median of a handful of requests says nothing; use the fixed minimum until there are enough.
  const slowThresholdMs =
    durations.length >= o.slowMinSamples
      ? Math.min(o.slowAbsoluteMs, Math.max(o.slowMinMs, (rawMedian ?? 0) * o.slowMedianFactor))
      : o.slowMinMs;

  // 1. Group problem events into issues.
  const groups = new Map<string, { kind: IssueKind; events: TrailEvent[] }>();
  const keyOfEvent = new Map<TrailEvent, string>();
  for (const e of events) {
    const c = classify(e, slowThresholdMs);
    if (!c) continue;
    keyOfEvent.set(e, c.key);
    const g = groups.get(c.key);
    if (g) g.events.push(e);
    else groups.set(c.key, { kind: c.kind, events: [e] });
  }

  const actions = events.filter((e): e is ActionEvent => e.type === 'action');
  const triggerFor = (time: number): ActionEvent | undefined => {
    let found: ActionEvent | undefined;
    for (const a of actions) {
      if (a.time > time) break;
      if (time - a.time <= o.triggerWindowMs) found = a;
    }
    return found;
  };

  const issuesById: Record<string, Issue> = {};
  for (const [id, g] of groups) {
    const first = g.events[0];
    const src = eventSourceUrl(first);
    const trigger = first.type === 'action' ? undefined : triggerFor(first.time);
    let title = '';
    let tag = '';
    if (first.type === 'request') {
      title = shortRequestLabel(first.method, first.url, inv.pageUrl);
      tag = g.kind === 'slow' ? formatDuration(requestDuration(first) ?? 0) : requestOutcome(first);
    } else if (first.type === 'console') {
      title = firstLine(first.text);
      tag = consoleLocation(first) ?? (first.source === 'exception' ? 'uncaught' : `console.${first.level}`);
    }
    issuesById[id] = {
      id,
      kind: g.kind,
      title,
      tag,
      occurrences: g.events,
      count: g.events.length,
      time: first.time,
      score: 0,
      severity: 'low',
      reasons: [],
      noise: matchNoise(first, o.noiseRules)?.reason,
      muted: muted.has(id),
      firstParty: src ? isSameSite(src, inv.pageUrl) : null,
      trigger,
      triggerGapMs: trigger ? first.time - trigger.time : undefined,
      causes: [],
    };
  }

  // 2. Causal links: an error right after a failed request most likely came from it.
  const failedRequestIssues = Object.values(issuesById).filter((i) => i.kind === 'request' && !i.noise);
  for (const issue of Object.values(issuesById)) {
    if (issue.kind !== 'error') continue;
    const err = issue.occurrences[0] as ConsoleEvent;
    const errScripts = new Set((err.stack ?? []).map((f) => f.url));
    let best: { issue: Issue; endTime: number; sharedScript: boolean } | undefined;
    for (const req of failedRequestIssues) {
      for (const occ of req.occurrences as RequestEvent[]) {
        const end = occ.endTime ?? occ.time;
        if (end > err.time || err.time - end > o.causalWindowMs) continue;
        const sharedScript = (occ.initiatorScripts ?? []).some((s) => errScripts.has(s));
        // Prefer a request whose initiator shares a script with the error stack, then the most recent one.
        if (
          !best ||
          (sharedScript && !best.sharedScript) ||
          (sharedScript === best.sharedScript && end > best.endTime)
        ) {
          best = { issue: req, endTime: end, sharedScript };
        }
      }
    }
    if (best) {
      issue.causedBy = best.issue.id;
      best.issue.causes.push(issue.id);
    }
  }

  // 3. Score every issue, keeping the reasons so the UI can explain the rank.
  for (const issue of Object.values(issuesById)) {
    const reasons: Reason[] = [];
    const add = (points: number, text: string) => reasons.push({ points, text });
    const first = issue.occurrences[0];

    if (first.type === 'request' && issue.kind === 'request') {
      const where = issue.firstParty ? 'your own API' : 'a third-party service';
      if (first.failure?.kind === 'network') {
        if (first.failure.corsError) add(issue.firstParty ? 35 : 25, `Blocked by CORS (${first.failure.corsError})`);
        else add(issue.firstParty ? 35 : 20, `Request never completed (${first.failure.errorText})`);
      } else if ((first.status ?? 0) >= 500) {
        add(issue.firstParty ? 40 : 20, `Server error (${first.status}) from ${where}`);
      } else if (first.status === 401 || first.status === 403) {
        add(20, `Access denied (${first.status}) by ${where}`);
      } else {
        add(issue.firstParty ? 25 : 15, `Client error (${first.status}) from ${where}`);
      }
      if (first.resourceType === 'Document') add(15, 'The page itself failed to load');
    } else if (issue.kind === 'slow' && first.type === 'request') {
      const d = requestDuration(first) ?? 0;
      const ratio = medianRequestMs ? d / medianRequestMs : 0;
      add(
        15 + Math.min(15, Math.round(ratio)),
        ratio >= 2
          ? `${Math.round(ratio)}× slower than the median request (${formatDuration(medianRequestMs!)})`
          : `Took ${formatDuration(d)}`,
      );
    } else if (first.type === 'console' && issue.kind === 'error') {
      if (first.source === 'exception')
        add(40, /promise/i.test(first.text) ? 'Unhandled promise rejection' : 'Uncaught exception');
      else if (first.source === 'browser') add(25, 'Error reported by the browser');
      else add(25, 'Logged with console.error');
    } else if (issue.kind === 'warning') {
      add(5, 'Warning');
    }

    if (issue.trigger && issue.triggerGapMs !== undefined) {
      // A click is strong evidence; "during page load" is true of almost everything.
      const base = issue.trigger.kind === 'navigate' ? 10 : 25;
      add(
        issue.kind === 'warning' ? Math.round(base / 5) : base,
        issue.trigger.kind === 'navigate'
          ? `During page load (${describeAction(issue.trigger).replace(/^Opened /, '')})`
          : `${formatDuration(issue.triggerGapMs)} after ${actionPhrase(issue.trigger)}`,
      );
    }
    if (issue.causes.length > 0) {
      add(
        20,
        `Probably caused ${issue.causes.length === 1 ? 'the error that followed' : `${issue.causes.length} errors that followed`}`,
      );
    }
    if (issue.causedBy) {
      const cause = issuesById[issue.causedBy];
      add(10, `Follows the failed ${cause.title}`);
    }
    if (issue.firstParty === true && issue.kind !== 'request' && issue.kind !== 'slow') add(10, 'In your own code');
    if (issue.firstParty === false && issue.kind !== 'request') add(-10, 'From a third-party origin');
    if (issue.count > 1) add(Math.min(10, Math.round(3 * Math.log2(issue.count))), `Happened ${issue.count} times`);
    if (issue.noise) add(-40, `Known noise: ${issue.noise}`);

    issue.reasons = reasons;
    issue.score = clampScore(reasons);
  }

  // A consequence never outranks its cause: fixing the cause usually fixes both.
  for (const issue of Object.values(issuesById)) {
    const cause = issue.causedBy ? issuesById[issue.causedBy] : undefined;
    if (cause && issue.score >= cause.score) {
      issue.reasons.push({ points: cause.score - 1 - issue.score, text: 'Ranked just below its likely cause' });
      issue.score = clampScore(issue.reasons);
    }
  }
  for (const issue of Object.values(issuesById)) {
    issue.severity = severityOf(issue.score);
    issue.reasons.sort((a, b) => b.points - a.points);
  }

  const visible = Object.values(issuesById)
    .filter((i) => !i.muted)
    .sort((a, b) => b.score - a.score || a.time - b.time);

  // 4. The story: one chapter per user action.
  const chapters: Chapter[] = [];
  let current: Chapter | undefined;
  let lastAction: ActionEvent | undefined;
  const rowIndex = new Map<string, StoryRow>();
  const startChapter = (action: ActionEvent | undefined, time: number) => {
    current = {
      id: action?.id ?? 'before',
      action,
      title: action ? describeAction(action) : 'Before your first action',
      time,
      rows: [],
      passedRequests: 0,
      quietMessages: 0,
    };
    chapters.push(current);
    rowIndex.clear();
  };

  for (const e of events) {
    if (e.type === 'action') {
      if (!isContinuation(lastAction, e)) startChapter(e, e.time);
      lastAction = e;
      continue;
    }
    if (!current) startChapter(undefined, e.time);
    const chapter = current!;
    const key = keyOfEvent.get(e);
    if (!key) {
      if (e.type === 'request') chapter.passedRequests++;
      else chapter.quietMessages++;
      continue;
    }
    const issue = issuesById[key];
    if (issue.muted) continue;
    const existing = rowIndex.get(key);
    if (existing) {
      existing.countInChapter++;
      continue;
    }
    const row: StoryRow = { issueId: key, countInChapter: 1, indent: false };
    rowIndex.set(key, row);
    chapter.rows.push(row);
  }

  // Within a chapter, draw an effect directly under its cause.
  for (const chapter of chapters) {
    const ordered: StoryRow[] = [];
    const placed = new Set<StoryRow>();
    const byId = new Map(chapter.rows.map((r) => [r.issueId, r]));
    for (const row of chapter.rows) {
      if (placed.has(row)) continue;
      const cause = issuesById[row.issueId].causedBy;
      if (cause && byId.has(cause)) continue; // placed with its cause
      ordered.push(row);
      placed.add(row);
      for (const effectId of issuesById[row.issueId].causes) {
        const effect = byId.get(effectId);
        if (effect && !placed.has(effect)) {
          effect.indent = true;
          ordered.push(effect);
          placed.add(effect);
        }
      }
    }
    // Effects whose cause sits in an earlier chapter.
    for (const row of chapter.rows) if (!placed.has(row)) ordered.push(row);
    chapter.rows = ordered;
  }

  const all = Object.values(issuesById);
  const counts: AnalysisCounts = {
    requests: requests.length,
    passed: requests.filter((r) => !keyOfEvent.has(r)).length,
    failed: all.filter((i) => i.kind === 'request' && !i.noise && !i.muted).reduce((n, i) => n + i.count, 0),
    slow: all.filter((i) => i.kind === 'slow' && !i.muted).reduce((n, i) => n + i.count, 0),
    errors: all.filter((i) => i.kind === 'error' && !i.noise && !i.muted).reduce((n, i) => n + i.count, 0),
    warnings: all.filter((i) => i.kind === 'warning' && !i.noise && !i.muted).reduce((n, i) => n + i.count, 0),
    noise: all.filter((i) => i.noise && !i.muted).reduce((n, i) => n + i.count, 0),
    muted: all.filter((i) => i.muted).reduce((n, i) => n + i.count, 0),
  };

  return {
    issues: visible,
    issuesById,
    chapters,
    counts,
    summary: summarize(visible, issuesById, medianRequestMs),
    medianRequestMs,
    slowThresholdMs,
  };
}

const REJECTION = 'Unhandled promise rejection: ';

/** `threw TypeError: … (auth.ts:42)` / `had an unhandled promise rejection: TypeError: …`. */
function errorPhrase(issue: Issue): string {
  const where = issue.tag ? ` (${issue.tag})` : '';
  return issue.title.startsWith(REJECTION)
    ? `had an unhandled promise rejection: ${issue.title.slice(REJECTION.length)}${where}`
    : `threw ${issue.title}${where}`;
}

/** One or two plain sentences about the most likely cause. */
export function summarize(ranked: Issue[], byId: Record<string, Issue>, medianRequestMs?: number): string | null {
  const top = ranked.find((i) => !i.noise && i.kind !== 'warning');
  if (!top) return null;
  // Lead with the root cause when the top issue is an effect of another.
  const root = top.causedBy ? byId[top.causedBy] : top;
  const lead = root.trigger ? `After ${actionPhrase(root.trigger)}, ` : '';
  const cap = (s: string) => (lead ? s : s.charAt(0).toUpperCase() + s.slice(1));
  const first = root.occurrences[0];

  let sentence: string;
  if (first.type === 'request' && root.kind === 'request') {
    const d = requestDuration(first);
    const outcome =
      first.failure?.kind === 'network'
        ? first.failure.corsError
          ? 'was blocked by CORS'
          : `failed (${first.failure.errorText})`
        : `returned ${first.status}`;
    sentence = `${lead}${cap(root.title)} ${outcome}${d !== undefined ? ` after ${formatDuration(d)}` : ''}.`;
  } else if (first.type === 'request' && root.kind === 'slow') {
    const d = requestDuration(first) ?? 0;
    const ratio = medianRequestMs ? Math.round(d / medianRequestMs) : 0;
    sentence = `${lead}${cap(root.title)} took ${formatDuration(d)}${ratio >= 2 ? `, ${ratio}× slower than the median request` : ''}.`;
  } else {
    sentence = `${lead}${lead ? 'the' : 'The'} page ${errorPhrase(root)}.`;
  }

  const effects = root.causes.map((id) => byId[id]).filter((i) => i && !i.muted);
  if (effects.length > 0) {
    const e = effects[0];
    sentence += ` The page then ${errorPhrase(e)}.`;
  }
  return sentence;
}
