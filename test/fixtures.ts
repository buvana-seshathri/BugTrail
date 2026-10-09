import type { ActionEvent, ConsoleEvent, Investigation, RequestEvent, TrailEvent } from '../src/core/types';

export const T0 = Date.UTC(2026, 9, 9, 10, 0, 0);
export const PAGE = 'https://staging.acme.dev/login';

let n = 0;
const id = (p: string) => `${p}-${n++}`;

export function action(
  at: number,
  kind: ActionEvent['kind'],
  label?: string,
  selector = 'form#signin › button',
): ActionEvent {
  return {
    type: 'action',
    id: id('act'),
    time: T0 + at,
    kind,
    url: PAGE,
    target: kind === 'navigate' ? undefined : { selector, label, tag: 'button' },
  };
}

export function request(
  at: number,
  dur: number,
  method: string,
  url: string,
  status: number,
  extra: Partial<RequestEvent> = {},
): RequestEvent {
  return {
    type: 'request',
    id: id('req'),
    time: T0 + at,
    endTime: T0 + at + dur,
    method,
    url,
    resourceType: 'Fetch',
    status,
    failure: status >= 400 ? { kind: 'http', status } : undefined,
    ...extra,
  };
}

export function log(
  at: number,
  level: ConsoleEvent['level'],
  text: string,
  extra: Partial<ConsoleEvent> = {},
): ConsoleEvent {
  return { type: 'console', id: id('con'), time: T0 + at, level, source: 'console', text, ...extra };
}

export function investigation(events: TrailEvent[], extra: Partial<Investigation> = {}): Investigation {
  return {
    id: 'inv-test',
    title: 'Login is broken',
    tabId: 1,
    pageUrl: PAGE,
    startedAt: T0,
    events,
    mutedFingerprints: [],
    ...extra,
  };
}

/** The scenario from the design: clicking “Sign in” → 500 → TypeError, plus the usual noise. */
export function loginScenario(): Investigation {
  const events: TrailEvent[] = [
    action(2000, 'navigate'),
    request(2100, 120, 'GET', 'https://staging.acme.dev/login', 200, { resourceType: 'Document' }),
    request(2300, 2400, 'GET', 'https://staging.acme.dev/api/flags', 200),
    request(2400, 30, 'GET', 'https://staging.acme.dev/favicon.ico', 404, { resourceType: 'Other' }),
    request(2500, 40, 'GET', 'https://www.google-analytics.com/collect', 0, {
      status: undefined,
      failure: { kind: 'network', errorText: 'net::ERR_BLOCKED_BY_CLIENT' },
    }),
  ];
  for (let i = 0; i < 38; i++) {
    events.push(log(2500 + i * 10, 'error', `Warning: Each child in a list should have a unique "key" prop.%s`));
  }
  for (let i = 0; i < 12; i++)
    events.push(
      request(2600 + i * 50, 60 + i * 5, 'GET', `https://staging.acme.dev/static/chunk-${i}.js`, 200, {
        resourceType: 'Script',
      }),
    );
  events.push(action(10400, 'input', 'Email', 'form#signin › input#email'));
  events.push(action(11000, 'input', 'Email', 'form#signin › input#email'));
  events.push(action(13900, 'click', 'Sign in'));
  events.push(
    request(14040, 812, 'POST', 'https://staging.acme.dev/api/v2/auth/login', 500, {
      initiator: 'https://staging.acme.dev/assets/auth.ts:31',
      initiatorScripts: ['https://staging.acme.dev/assets/auth.ts'],
      postData: '{"email":"dana@acme.dev","password":"hunter2"}',
      requestHeaders: { authorization: 'Bearer abc.def', 'content-type': 'application/json' },
      responseBody: '{"error":"INTERNAL","message":"session store unavailable"}',
    }),
  );
  events.push(
    log(14970, 'error', "TypeError: Cannot read properties of undefined (reading 'token')", {
      source: 'exception',
      stack: [{ url: 'https://staging.acme.dev/assets/auth.ts', line: 42, column: 18, functionName: 'onLogin' }],
    }),
  );
  for (const at of [15000, 15600, 16300])
    events.push(request(at, 40, 'GET', 'https://staging.acme.dev/api/v2/user/me', 401));
  events.push(request(15100, 50, 'GET', 'https://staging.acme.dev/api/ping', 200));
  return investigation(events);
}
