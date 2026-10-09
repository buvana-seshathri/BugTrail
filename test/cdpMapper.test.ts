import { describe, expect, it } from 'vitest';
import { CdpEventMapper, formatConsoleArgs } from '../src/capture/cdpMapper';
import type { ActionEvent, ConsoleEvent, RequestEvent } from '../src/core/types';

const START = 1_760_000_000_000; // epoch ms
const WALL = START / 1000 + 1; // 1 s after start, in epoch seconds
const MONO = 5000; // arbitrary monotonic clock, seconds

describe('CdpEventMapper — network', () => {
  it('builds a failed request from the CDP sequence and asks for its body', () => {
    const m = new CdpEventMapper(START);
    const sent = m.handle('Network.requestWillBeSent', {
      requestId: '7',
      timestamp: MONO,
      wallTime: WALL,
      type: 'Fetch',
      request: {
        url: 'https://app.dev/api/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        postData: '{"a":1}',
      },
      initiator: {
        type: 'script',
        stack: {
          callFrames: [{ url: 'https://app.dev/auth.js', functionName: 'login', lineNumber: 30, columnNumber: 4 }],
        },
      },
    });
    const req = sent.events[0] as RequestEvent;
    expect(req.time).toBe(START + 1000);
    expect(req.initiator).toBe('https://app.dev/auth.js:31');
    expect(req.requestHeaders).toEqual({ 'content-type': 'application/json' });

    m.handle('Network.responseReceived', {
      requestId: '7',
      type: 'Fetch',
      response: { status: 500, statusText: 'Internal Server Error', mimeType: 'application/json', headers: {} },
    });
    const done = m.handle('Network.loadingFinished', {
      requestId: '7',
      timestamp: MONO + 0.812,
      encodedDataLength: 120,
    });
    expect(done.fetchBodyFor).toBe('7');
    const finished = done.events[0] as RequestEvent;
    expect(finished.endTime! - finished.time).toBe(812);
    expect(finished.failure).toEqual({ kind: 'http', status: 500 });

    const withBody = m.attachBody('7', '{"error":"x"}', false) as RequestEvent;
    expect(withBody.responseBody).toBe('{"error":"x"}');
  });

  it('records network-level failures including CORS', () => {
    const m = new CdpEventMapper(START);
    m.handle('Network.requestWillBeSent', {
      requestId: '1',
      timestamp: MONO,
      wallTime: WALL,
      type: 'XHR',
      request: { url: 'https://api.other.com/x', method: 'GET' },
    });
    const r = m.handle('Network.loadingFailed', {
      requestId: '1',
      timestamp: MONO + 0.1,
      errorText: 'net::ERR_FAILED',
      corsErrorStatus: { corsError: 'MissingAllowOriginHeader' },
    });
    expect((r.events[0] as RequestEvent).failure).toEqual({
      kind: 'network',
      errorText: 'net::ERR_FAILED',
      blockedReason: undefined,
      corsError: 'MissingAllowOriginHeader',
    });
  });

  it('ignores data: URLs and requests sent before the investigation started', () => {
    const m = new CdpEventMapper(START);
    expect(
      m.handle('Network.requestWillBeSent', {
        requestId: '1',
        timestamp: MONO,
        wallTime: WALL,
        request: { url: 'data:image/png;base64,xx', method: 'GET' },
      }).events,
    ).toEqual([]);
    expect(
      m.handle('Network.requestWillBeSent', {
        requestId: '2',
        timestamp: MONO,
        wallTime: START / 1000 - 5,
        request: { url: 'https://a.dev/', method: 'GET' },
      }).events,
    ).toEqual([]);
  });

  it('keeps each redirect hop as its own request', () => {
    const m = new CdpEventMapper(START);
    m.handle('Network.requestWillBeSent', {
      requestId: '3',
      timestamp: MONO,
      wallTime: WALL,
      request: { url: 'https://a.dev/old', method: 'GET' },
    });
    const r = m.handle('Network.requestWillBeSent', {
      requestId: '3',
      timestamp: MONO + 0.05,
      wallTime: WALL + 0.05,
      request: { url: 'https://a.dev/new', method: 'GET' },
      redirectResponse: { status: 301 },
    });
    const [hop, next] = r.events as RequestEvent[];
    expect(hop.url).toBe('https://a.dev/old');
    expect(hop.status).toBe(301);
    expect(hop.id).not.toBe(next.id);
    expect(next.url).toBe('https://a.dev/new');
  });
});

describe('CdpEventMapper — console', () => {
  it('maps console.error with format substitutions and a 1-based stack', () => {
    const m = new CdpEventMapper(START);
    const r = m.handle('Runtime.consoleAPICalled', {
      type: 'error',
      timestamp: START + 50,
      args: [
        { type: 'string', value: 'Failed for %s (%d)' },
        { type: 'string', value: 'dana' },
        { type: 'number', value: 3.7 },
      ],
      stackTrace: { callFrames: [{ url: 'https://app.dev/a.js', lineNumber: 9, columnNumber: 0, functionName: '' }] },
    });
    const e = r.events[0] as ConsoleEvent;
    expect(e.level).toBe('error');
    expect(e.text).toBe('Failed for dana (3)');
    expect(e.stack?.[0]).toEqual({ url: 'https://app.dev/a.js', functionName: undefined, line: 10, column: 1 });
  });

  it('maps uncaught exceptions and unhandled rejections', () => {
    const m = new CdpEventMapper(START);
    const thrown = m.handle('Runtime.exceptionThrown', {
      timestamp: START + 10,
      exceptionDetails: {
        text: 'Uncaught',
        exception: { type: 'object', subtype: 'error', description: 'TypeError: x is undefined\n    at f (a.js:1:1)' },
      },
    }).events[0] as ConsoleEvent;
    expect(thrown.source).toBe('exception');
    expect(thrown.text).toMatch(/^TypeError: x is undefined/);

    const rejected = m.handle('Runtime.exceptionThrown', {
      timestamp: START + 20,
      exceptionDetails: { text: 'Uncaught (in promise)', exception: { type: 'string', value: 'nope' } },
    }).events[0] as ConsoleEvent;
    expect(rejected.text).toBe('Unhandled promise rejection: nope');
  });

  it('drops network log lines that duplicate the request, and history from before the start', () => {
    const m = new CdpEventMapper(START);
    expect(
      m.handle('Log.entryAdded', {
        entry: { source: 'network', level: 'error', text: 'Failed to load resource', timestamp: START + 5 },
      }).events,
    ).toEqual([]);
    expect(m.handle('Runtime.consoleAPICalled', { type: 'log', timestamp: START - 1, args: [] }).events).toEqual([]);
  });

  it('formats objects, null and undefined', () => {
    expect(
      formatConsoleArgs([
        { type: 'object', subtype: 'null' },
        { type: 'undefined' },
        { type: 'object', description: 'Object' },
        { type: 'number', unserializableValue: 'NaN' },
      ]),
    ).toBe('null undefined Object NaN');
  });
});

describe('CdpEventMapper — actions', () => {
  it('turns probe binding calls into actions', () => {
    const m = new CdpEventMapper(START);
    const r = m.handle('Runtime.bindingCalled', {
      name: '__bugtrail',
      payload: JSON.stringify({
        v: 1,
        time: START + 5,
        kind: 'click',
        url: 'https://app.dev/',
        target: { selector: 'button#go', label: 'Go', tag: 'button' },
      }),
    });
    const a = r.events[0] as ActionEvent;
    expect(a.kind).toBe('click');
    expect(a.target?.label).toBe('Go');
  });

  it('ignores other bindings and malformed payloads', () => {
    const m = new CdpEventMapper(START);
    expect(m.handle('Runtime.bindingCalled', { name: 'other', payload: '{}' }).events).toEqual([]);
    expect(m.handle('Runtime.bindingCalled', { name: '__bugtrail', payload: 'not json' }).events).toEqual([]);
  });

  it('records a navigation when the main-frame document is requested, not when it commits', () => {
    const m = new CdpEventMapper(START);
    m.setMainFrame('F1');
    const sent = m.handle('Network.requestWillBeSent', {
      requestId: 'L1',
      loaderId: 'L1',
      frameId: 'F1',
      type: 'Document',
      timestamp: MONO,
      wallTime: WALL,
      request: { url: 'https://app.dev/login', method: 'GET' },
    });
    expect(sent.events.map((e) => e.type)).toEqual(['action', 'request']);
    expect(sent.events[0].time).toBeLessThan(sent.events[1].time);
    // The later commit for the same loader is not recorded twice.
    expect(
      m.handle('Page.frameNavigated', { frame: { id: 'F1', loaderId: 'L1', url: 'https://app.dev/login' } }).events,
    ).toEqual([]);
    // Single-page-app navigations are recorded too.
    expect(
      m.handle('Page.navigatedWithinDocument', { frameId: 'F1', url: 'https://app.dev/home' }).events[0],
    ).toMatchObject({
      kind: 'navigate',
      url: 'https://app.dev/home',
    });
  });

  it('records main-frame navigations only', () => {
    const m = new CdpEventMapper(START);
    expect(m.handle('Page.frameNavigated', { frame: { url: 'https://app.dev/next' } }).events[0]).toMatchObject({
      kind: 'navigate',
      url: 'https://app.dev/next',
    });
    expect(m.handle('Page.frameNavigated', { frame: { parentId: 'x', url: 'https://ads.dev/' } }).events).toEqual([]);
  });
});
