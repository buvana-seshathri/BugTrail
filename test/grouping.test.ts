import { describe, expect, it } from 'vitest';
import { normalizeMessage, normalizePath } from '../src/core/fingerprint';
import { matchNoise } from '../src/core/noise';
import { isSameSite, shortUrl, siteOf } from '../src/core/url';
import { createSession, MAX_EVENTS, upsertEvents } from '../src/background/sessions';
import { log, request } from './fixtures';

describe('fingerprinting', () => {
  it('normalises ids, numbers and urls in messages', () => {
    expect(normalizeMessage('Order 123 failed at https://a.dev/x?id=9 (trace 9f2c41e0b7aa)')).toBe(
      'Order # failed at <url> (trace <hex>)',
    );
  });

  it('collapses id-like path segments', () => {
    expect(normalizePath('https://a.dev/users/123/orders/550e8400-e29b-41d4-a716-446655440000')).toBe(
      'a.dev/users/:n/orders/:id',
    );
    expect(normalizePath('https://a.dev/users/me')).toBe('a.dev/users/me');
  });
});

describe('noise rules', () => {
  it('matches the built-in patterns', () => {
    expect(matchNoise(request(0, 1, 'GET', 'https://a.dev/favicon.ico', 404))?.id).toBe('favicon');
    expect(matchNoise(request(0, 1, 'GET', 'https://a.dev/app.js.map', 404))?.id).toBe('sourcemap');
    expect(matchNoise(log(0, 'info', 'Download the React DevTools for a better development experience'))?.id).toBe(
      'react-devtools',
    );
    expect(
      matchNoise(log(0, 'error', 'boom', { stack: [{ url: 'chrome-extension://abc/x.js', line: 1, column: 1 }] }))?.id,
    ).toBe('extension');
    expect(matchNoise(request(0, 1, 'GET', 'https://a.dev/api', 500))).toBeUndefined();
  });
});

describe('url helpers', () => {
  it('approximates sites', () => {
    expect(siteOf('https://staging.acme.dev/x')).toBe('acme.dev');
    expect(siteOf('http://localhost:3000/')).toBe('localhost');
    expect(siteOf('http://127.0.0.1:8080/')).toBe('127.0.0.1');
    expect(isSameSite('https://api.acme.dev', 'https://app.acme.dev')).toBe(true);
    expect(isSameSite('https://cdn.other.com', 'https://app.acme.dev')).toBe(false);
  });

  it('shortens same-host urls to their path', () => {
    expect(shortUrl('https://app.acme.dev/api?x=1', 'https://app.acme.dev/')).toBe('/api?x=1');
    expect(shortUrl('https://api.acme.dev/api', 'https://app.acme.dev/')).toBe('api.acme.dev/api');
  });
});

describe('sessions', () => {
  it('upserts by id and caps the event count', () => {
    const s = createSession(1, '  ', 'https://a.dev/');
    expect(s.inv.title).toBe('Untitled investigation');
    const r = request(0, 1, 'GET', 'https://a.dev/x', 200);
    upsertEvents(s, [r]);
    upsertEvents(s, [{ ...r, status: 500 }]);
    expect(s.inv.events).toHaveLength(1);
    expect((s.inv.events[0] as typeof r).status).toBe(500);

    for (let i = 0; i < MAX_EVENTS + 5; i++) upsertEvents(s, [{ ...r, id: `x${i}` }]);
    expect(s.inv.events).toHaveLength(MAX_EVENTS);
    expect(s.truncated).toBe(true);
  });
});
