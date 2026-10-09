import type { ActionEvent, ConsoleEvent, ConsoleLevel, RequestEvent, StackFrame, TrailEvent } from '../core/types';
import { BINDING_NAME, type ProbePayload } from './probeProtocol';

/**
 * Translates raw Chrome DevTools Protocol events into BugTrail `TrailEvent`s.
 *
 * Kept free of `chrome.*` calls so it can be driven by recorded CDP traffic in
 * tests. The background worker feeds it every `chrome.debugger.onEvent` and
 * stores whatever it returns.
 *
 * Only the fields we use are typed below; CDP sends more.
 */

export { BINDING_NAME };
const MAX_BODY = 16 * 1024;

interface CdpCallFrame {
  url: string;
  functionName?: string;
  lineNumber: number;
  columnNumber: number;
}
interface CdpStackTrace {
  callFrames: CdpCallFrame[];
  parent?: CdpStackTrace;
}
interface CdpRemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

export interface MapResult {
  /** Events created or updated by this CDP message. */
  events: TrailEvent[];
  /** Set when the caller should fetch the response body (`Network.getResponseBody`) for this request id. */
  fetchBodyFor?: string;
}

const NOTHING: MapResult = { events: [] };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function truncate(text: string | undefined, max = MAX_BODY): string | undefined {
  if (text === undefined) return undefined;
  return text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text;
}

function toFrames(stack?: CdpStackTrace): StackFrame[] | undefined {
  if (!stack) return undefined;
  const frames: StackFrame[] = [];
  for (let s: CdpStackTrace | undefined = stack; s; s = s.parent) {
    for (const f of s.callFrames) {
      // CDP line/column numbers are 0-based; humans count from 1.
      frames.push({
        url: f.url,
        functionName: f.functionName || undefined,
        line: f.lineNumber + 1,
        column: f.columnNumber + 1,
      });
    }
  }
  return frames.length ? frames : undefined;
}

export function formatRemoteObject(o: CdpRemoteObject): string {
  if (o.type === 'string') return String(o.value);
  if (o.unserializableValue !== undefined) return o.unserializableValue;
  if (o.type === 'undefined') return 'undefined';
  if (o.subtype === 'null') return 'null';
  if (o.type === 'number' || o.type === 'boolean' || o.type === 'bigint') return String(o.value);
  if (o.value !== undefined && o.type === 'object') {
    try {
      return JSON.stringify(o.value);
    } catch {
      /* fall through */
    }
  }
  return o.description ?? o.subtype ?? o.type;
}

/** Applies `%s`/`%d`/`%i`/`%f`/`%o`/`%O`/`%c` substitutions the way the console does, roughly. */
export function formatConsoleArgs(args: CdpRemoteObject[]): string {
  if (args.length === 0) return '';
  const [first, ...rest] = args;
  if (first.type !== 'string' || !/%[sdifoOc]/.test(String(first.value))) {
    return args.map(formatRemoteObject).join(' ');
  }
  let i = 0;
  const head = String(first.value).replace(/%([sdifoOc])/g, (m, f: string) => {
    if (i >= rest.length) return m;
    const arg = rest[i++];
    if (f === 'c') return '';
    if (f === 'd' || f === 'i') return String(Math.trunc(Number(arg.value)));
    if (f === 'f') return String(Number(arg.value));
    return formatRemoteObject(arg);
  });
  return [head, ...rest.slice(i).map(formatRemoteObject)].join(' ').trim();
}

function consoleLevel(type: string): ConsoleLevel {
  switch (type) {
    case 'error':
    case 'assert':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    case 'debug':
      return 'debug';
    default:
      return 'log';
  }
}

function lowerHeaders(h: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

export class CdpEventMapper {
  private requests = new Map<string, RequestEvent>();
  /** Per-request offset from CDP monotonic seconds to epoch milliseconds. */
  private clockOffset = new Map<string, number>();
  private lastOffset: number | undefined;
  /** Main frame id, so its document requests can be recognised as navigations. */
  private mainFrameId: string | undefined;
  /** Loader ids whose navigation was already recorded from the document request. */
  private navigatedLoaders = new Set<string>();

  /** Events with a timestamp before this are replays of history and are dropped. */
  constructor(private readonly startedAt: number) {}

  private wall(requestId: string, monotonicSeconds: number): number {
    const offset = this.clockOffset.get(requestId) ?? this.lastOffset ?? Date.now() - monotonicSeconds * 1000;
    return Math.round(monotonicSeconds * 1000 + offset);
  }

  handle(method: string, params: Record<string, unknown>): MapResult {
    switch (method) {
      case 'Network.requestWillBeSent':
        return this.onRequest(params);
      case 'Network.responseReceived':
        return this.onResponse(params);
      case 'Network.loadingFinished':
        return this.onFinished(params);
      case 'Network.loadingFailed':
        return this.onFailed(params);
      case 'Runtime.consoleAPICalled':
        return this.onConsole(params);
      case 'Runtime.exceptionThrown':
        return this.onException(params);
      case 'Log.entryAdded':
        return this.onLog(params);
      case 'Runtime.bindingCalled':
        return this.onBinding(params);
      case 'Page.frameNavigated':
        return this.onNavigated(params);
      case 'Page.navigatedWithinDocument':
        return this.onSameDocumentNavigation(params);
      default:
        return NOTHING;
    }
  }

  /** Tells the mapper which frame is the top-level one (from `Page.getFrameTree`). */
  setMainFrame(frameId: string): void {
    this.mainFrameId = frameId;
  }

  attachBody(requestId: string, body: string, base64Encoded: boolean): TrailEvent | undefined {
    const req = this.requests.get(requestId);
    if (!req) return undefined;
    req.responseBody = base64Encoded ? '[binary body not captured]' : truncate(body);
    return req;
  }

  private onRequest(p: Record<string, unknown>): MapResult {
    const requestId = p.requestId as string;
    const request = p.request as { url: string; method: string; headers?: Record<string, unknown>; postData?: string };
    if (request.url.startsWith('data:') || request.url.startsWith('blob:')) return NOTHING;
    const timestamp = p.timestamp as number;
    const wallTime = p.wallTime as number | undefined;
    if (wallTime !== undefined) {
      const offset = wallTime * 1000 - timestamp * 1000;
      this.clockOffset.set(requestId, offset);
      this.lastOffset = offset;
    }
    const time = this.wall(requestId, timestamp);
    if (time < this.startedAt) return NOTHING;

    const redirect = p.redirectResponse as { status: number } | undefined;
    const initiator = p.initiator as
      { type: string; url?: string; lineNumber?: number; stack?: CdpStackTrace } | undefined;
    const frames = toFrames(initiator?.stack);
    const firstFrame = frames?.[0];
    const scripts = frames ? [...new Set(frames.map((f) => f.url).filter(Boolean))] : undefined;

    // A redirect re-uses the request id; keep the earlier hop as its own (passed) request.
    const previous = this.requests.get(requestId);
    if (previous && redirect) {
      previous.status = redirect.status;
      previous.endTime = time;
      previous.id = `${previous.id}-r${redirect.status}`;
    }

    const event: RequestEvent = {
      type: 'request',
      id: `req-${requestId}`,
      time,
      method: request.method,
      url: request.url,
      resourceType: (p.type as string) ?? 'Other',
      initiator: firstFrame
        ? `${firstFrame.url}:${firstFrame.line}`
        : initiator?.url
          ? `${initiator.url}${initiator.lineNumber !== undefined ? `:${initiator.lineNumber + 1}` : ''}`
          : undefined,
      initiatorScripts: scripts,
      requestHeaders: lowerHeaders(request.headers),
      postData: truncate(request.postData),
    };
    this.requests.set(requestId, event);
    const events: TrailEvent[] = previous && redirect ? [previous, event] : [event];

    // A top-level document request *is* the navigation. CDP only reports
    // `frameNavigated` once the response arrives, which would put the page's
    // own request before the "Opened …" chapter, so record it here instead.
    const loaderId = p.loaderId as string | undefined;
    if (
      p.type === 'Document' &&
      this.mainFrameId !== undefined &&
      p.frameId === this.mainFrameId &&
      loaderId === requestId &&
      !redirect
    ) {
      this.navigatedLoaders.add(loaderId);
      events.unshift({ type: 'action', id: nextId('nav'), time: time - 1, kind: 'navigate', url: request.url });
    }
    return { events };
  }

  private onResponse(p: Record<string, unknown>): MapResult {
    const req = this.requests.get(p.requestId as string);
    if (!req) return NOTHING;
    const res = p.response as {
      status: number;
      statusText?: string;
      mimeType?: string;
      headers?: Record<string, unknown>;
    };
    req.status = res.status;
    req.statusText = res.statusText || undefined;
    req.mimeType = res.mimeType;
    req.responseHeaders = lowerHeaders(res.headers);
    if (p.type) req.resourceType = p.type as string;
    return { events: [req] };
  }

  private onFinished(p: Record<string, unknown>): MapResult {
    const requestId = p.requestId as string;
    const req = this.requests.get(requestId);
    if (!req) return NOTHING;
    req.endTime = this.wall(requestId, p.timestamp as number);
    req.encodedDataLength = p.encodedDataLength as number | undefined;
    if (req.status !== undefined && req.status >= 400) {
      req.failure = { kind: 'http', status: req.status };
      return { events: [req], fetchBodyFor: requestId };
    }
    return { events: [req] };
  }

  private onFailed(p: Record<string, unknown>): MapResult {
    const requestId = p.requestId as string;
    const req = this.requests.get(requestId);
    if (!req) return NOTHING;
    req.endTime = this.wall(requestId, p.timestamp as number);
    const cors = p.corsErrorStatus as { corsError?: string } | undefined;
    req.failure = {
      kind: 'network',
      errorText: (p.errorText as string) || 'Failed',
      blockedReason: (p.blockedReason as string) || undefined,
      corsError: cors?.corsError || undefined,
    };
    return { events: [req] };
  }

  private onConsole(p: Record<string, unknown>): MapResult {
    const time = Math.round(p.timestamp as number);
    if (time < this.startedAt) return NOTHING;
    const event: ConsoleEvent = {
      type: 'console',
      id: nextId('con'),
      time,
      level: consoleLevel(p.type as string),
      source: 'console',
      text: formatConsoleArgs((p.args as CdpRemoteObject[]) ?? []),
      stack: toFrames(p.stackTrace as CdpStackTrace | undefined),
    };
    return { events: [event] };
  }

  private onException(p: Record<string, unknown>): MapResult {
    const time = Math.round(p.timestamp as number);
    if (time < this.startedAt) return NOTHING;
    const d = p.exceptionDetails as {
      text: string;
      exception?: CdpRemoteObject;
      stackTrace?: CdpStackTrace;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    const description = d.exception?.description ?? (d.exception ? formatRemoteObject(d.exception) : undefined);
    const inPromise = /in promise/i.test(d.text);
    const message = description ?? d.text;
    let stack = toFrames(d.stackTrace);
    if (!stack && d.url) stack = [{ url: d.url, line: (d.lineNumber ?? 0) + 1, column: (d.columnNumber ?? 0) + 1 }];
    const event: ConsoleEvent = {
      type: 'console',
      id: nextId('exc'),
      time,
      level: 'error',
      source: 'exception',
      text: inPromise ? `Unhandled promise rejection: ${message}` : message,
      stack,
    };
    return { events: [event] };
  }

  private onLog(p: Record<string, unknown>): MapResult {
    const entry = p.entry as {
      source: string;
      level: string;
      text: string;
      timestamp: number;
      url?: string;
      networkRequestId?: string;
      stackTrace?: CdpStackTrace;
    };
    // Network log lines ("Failed to load resource: 500") duplicate the request itself.
    if (entry.source === 'network' || entry.networkRequestId) return NOTHING;
    const time = Math.round(entry.timestamp);
    if (time < this.startedAt) return NOTHING;
    const level: ConsoleLevel =
      entry.source === 'violation' ? 'info' : entry.level === 'verbose' ? 'debug' : consoleLevel(entry.level);
    const event: ConsoleEvent = {
      type: 'console',
      id: nextId('log'),
      time,
      level,
      source: 'browser',
      text: entry.text,
      url: entry.url,
      stack: toFrames(entry.stackTrace),
    };
    return { events: [event] };
  }

  private onBinding(p: Record<string, unknown>): MapResult {
    if (p.name !== BINDING_NAME) return NOTHING;
    let payload: ProbePayload;
    try {
      payload = JSON.parse(p.payload as string) as ProbePayload;
    } catch {
      return NOTHING;
    }
    if (payload.v !== 1 || payload.time < this.startedAt) return NOTHING;
    const event: ActionEvent = {
      type: 'action',
      id: nextId('act'),
      time: payload.time,
      kind: payload.kind,
      url: payload.url,
      target: payload.target,
      key: payload.key,
    };
    return { events: [event] };
  }

  private onNavigated(p: Record<string, unknown>): MapResult {
    const frame = p.frame as { id?: string; parentId?: string; loaderId?: string; url: string; urlFragment?: string };
    if (frame.parentId) return NOTHING;
    if (frame.id) this.mainFrameId ??= frame.id;
    if (frame.loaderId && this.navigatedLoaders.has(frame.loaderId)) return NOTHING;
    const event: ActionEvent = {
      type: 'action',
      id: nextId('nav'),
      time: Date.now(),
      kind: 'navigate',
      url: frame.url + (frame.urlFragment ?? ''),
    };
    return { events: [event] };
  }

  /** History API / hash changes in single-page apps. */
  private onSameDocumentNavigation(p: Record<string, unknown>): MapResult {
    if (this.mainFrameId === undefined || p.frameId !== this.mainFrameId) return NOTHING;
    const event: ActionEvent = {
      type: 'action',
      id: nextId('nav'),
      time: Date.now(),
      kind: 'navigate',
      url: p.url as string,
    };
    return { events: [event] };
  }
}
