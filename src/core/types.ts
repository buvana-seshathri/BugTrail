/**
 * BugTrail's domain model.
 *
 * Everything captured during an investigation is normalised into a `TrailEvent`.
 * The capture layer (CDP, page probe) produces these; the analysis layer
 * (grouping, correlation, ranking) consumes them. Nothing in `src/core` may
 * touch browser or extension APIs, so it can be unit-tested in isolation.
 */

/** Milliseconds since the Unix epoch. */
export type Timestamp = number;

export type ActionKind = 'navigate' | 'click' | 'input' | 'submit' | 'keypress';

/** A human-readable description of a DOM element the user interacted with. */
export interface ElementRef {
  /** Short CSS-ish selector, e.g. `form#signin › button[type=submit]`. */
  selector: string;
  /** Visible text or accessible name, trimmed. */
  label?: string;
  /** Lower-case tag name. */
  tag: string;
}

export interface ActionEvent {
  type: 'action';
  id: string;
  time: Timestamp;
  kind: ActionKind;
  /** Present for DOM actions; absent for navigations. */
  target?: ElementRef;
  /** URL for navigations; current page URL otherwise. */
  url: string;
  /** For `keypress`: the key (only Enter/Escape/Tab are recorded). */
  key?: string;
}

export type RequestFailure =
  { kind: 'http'; status: number } | { kind: 'network'; errorText: string; blockedReason?: string; corsError?: string };

export interface RequestEvent {
  type: 'request';
  id: string;
  /** When the request was sent. */
  time: Timestamp;
  /** When the response finished or the request failed; undefined while pending. */
  endTime?: Timestamp;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  failure?: RequestFailure;
  /** `url:line` of the script that started the request, if known. */
  initiator?: string;
  /** Script URLs on the initiator stack (for correlating with exceptions). */
  initiatorScripts?: string[];
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  /** Request body, already truncated. Redaction happens at export time. */
  postData?: string;
  /** Response body, only captured for failed requests, already truncated. */
  responseBody?: string;
  encodedDataLength?: number;
}

export type ConsoleLevel = 'error' | 'warning' | 'info' | 'log' | 'debug';

export interface StackFrame {
  url: string;
  functionName?: string;
  line: number;
  column: number;
}

export interface ConsoleEvent {
  type: 'console';
  id: string;
  time: Timestamp;
  level: ConsoleLevel;
  /** `console` (console.* call), `exception` (uncaught error / unhandled rejection), or `browser` (Log domain). */
  source: 'console' | 'exception' | 'browser';
  text: string;
  stack?: StackFrame[];
  /** For browser log entries tied to a network request. */
  url?: string;
}

export type TrailEvent = ActionEvent | RequestEvent | ConsoleEvent;

export interface Investigation {
  id: string;
  title: string;
  tabId: number;
  /** URL of the page when the investigation started. */
  pageUrl: string;
  startedAt: Timestamp;
  stoppedAt?: Timestamp;
  events: TrailEvent[];
  /** Fingerprints the user chose to mute. */
  mutedFingerprints: string[];
}
