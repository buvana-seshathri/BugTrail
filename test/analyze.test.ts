import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { action, investigation, log, loginScenario, request } from './fixtures';

describe('analyze — login scenario', () => {
  const a = analyze(loginScenario());

  it('ranks the failed login request first', () => {
    expect(a.issues[0].title).toBe('POST /api/v2/auth/login');
    expect(a.issues[0].tag).toBe('500');
    expect(a.issues[0].severity).toBe('critical');
  });

  it('explains the score with reasons that add up', () => {
    const top = a.issues[0];
    const texts = top.reasons.map((r) => r.text);
    expect(texts).toContain('Server error (500) from your own API');
    expect(texts.some((t) => t.includes('after you clicked “Sign in”'))).toBe(true);
    expect(texts).toContain('Probably caused the error that followed');
    const sum = top.reasons.reduce((s, r) => s + r.points, 0);
    expect(top.score).toBe(Math.min(100, sum));
  });

  it('links the TypeError to the failed request', () => {
    const err = a.issues.find((i) => i.kind === 'error' && i.title.startsWith('TypeError'))!;
    expect(err.causedBy).toBe(a.issues[0].id);
    expect(err.tag).toBe('auth.ts:42');
    expect(a.issues[0].causes).toEqual([err.id]);
    expect(err.score).toBeLessThan(a.issues[0].score);
    expect(err.reasons.map((r) => r.text)).toContain('Ranked just below its likely cause');
  });

  it('gives page-load timing and warnings little credit', () => {
    const flags = a.issues.find((i) => i.kind === 'slow')!;
    expect(flags.reasons.map((r) => r.text)).toContain('During page load (/login)');
    expect(flags.reasons.find((r) => r.text.startsWith('During page load'))!.points).toBe(10);
  });

  it('groups repeated messages instead of listing them 38 times', () => {
    const key = a.issues.find((i) => i.title.includes('unique "key" prop'))!;
    expect(key.count).toBe(38);
    expect(key.noise).toMatch(/list keys/);
    expect(key.score).toBeLessThan(35);
  });

  it('treats favicon 404s and ad-blocked requests as noise', () => {
    const noise = a.issues.filter((i) => i.noise).map((i) => i.title);
    expect(noise).toEqual(expect.arrayContaining(['GET /favicon.ico', 'GET www.google-analytics.com/collect']));
    expect(a.counts.failed).toBe(4); // the 500 + three 401s; noise excluded
  });

  it('flags the slow request relative to the session median', () => {
    const slow = a.issues.find((i) => i.kind === 'slow')!;
    expect(slow.title).toBe('GET /api/flags');
    expect(slow.tag).toBe('2.4 s');
    expect(slow.reasons[0].text).toMatch(/× slower than the median request/);
  });

  it('builds one chapter per action, merging consecutive typing in one field', () => {
    expect(a.chapters.map((c) => c.title)).toEqual(['Opened /login', 'Typed in “Email”', 'Clicked “Sign in”']);
    const click = a.chapters[2];
    const titles = click.rows.map((r) => a.issuesById[r.issueId].title);
    expect(titles[0]).toBe('POST /api/v2/auth/login');
    expect(titles[1]).toMatch(/^TypeError/);
    expect(click.rows[1].indent).toBe(true);
    expect(click.passedRequests).toBe(1);
    const me = click.rows.find((r) => a.issuesById[r.issueId].title === 'GET /api/v2/user/me')!;
    expect(me.countInChapter).toBe(3);
  });

  it('writes a one-sentence summary of the root cause', () => {
    expect(a.summary).toBe(
      "After you clicked “Sign in”, POST /api/v2/auth/login returned 500 after 812 ms. The page then threw TypeError: Cannot read properties of undefined (reading 'token') (auth.ts:42).",
    );
  });
});

describe('analyze — edge cases', () => {
  it('handles an empty investigation', () => {
    const a = analyze(investigation([]));
    expect(a.issues).toEqual([]);
    expect(a.chapters).toEqual([]);
    expect(a.summary).toBeNull();
  });

  it('puts activity before the first action in its own chapter', () => {
    const a = analyze(investigation([request(100, 50, 'GET', 'https://staging.acme.dev/api/x', 500)]));
    expect(a.chapters[0].title).toBe('Before your first action');
    expect(a.summary).toBe('GET /api/x returned 500 after 50 ms.');
  });

  it('excludes muted issues from the list and the story', () => {
    const inv = investigation([
      action(0, 'click', 'Go'),
      request(100, 50, 'GET', 'https://staging.acme.dev/api/x', 500),
    ]);
    const before = analyze(inv);
    const id = before.issues[0].id;
    const after = analyze({ ...inv, mutedFingerprints: [id] });
    expect(after.issues).toEqual([]);
    expect(after.chapters[0].rows).toEqual([]);
    expect(after.counts.muted).toBe(1);
  });

  it('does not credit an action that happened long before the event', () => {
    const a = analyze(
      investigation([action(0, 'click', 'Go'), request(10_000, 50, 'GET', 'https://staging.acme.dev/api/x', 500)]),
    );
    expect(a.issues[0].trigger).toBeUndefined();
  });

  it('ranks third-party failures below first-party ones', () => {
    const a = analyze(
      investigation([
        request(100, 50, 'GET', 'https://cdn.other.com/lib.js', 500),
        request(200, 50, 'GET', 'https://staging.acme.dev/api/x', 500),
      ]),
    );
    expect(a.issues.map((i) => i.title)).toEqual(['GET /api/x', 'GET cdn.other.com/lib.js']);
  });

  it('uses the fixed slow threshold until there are enough requests for a median', () => {
    const a = analyze(
      investigation([
        request(0, 20, 'GET', 'https://staging.acme.dev/', 200),
        request(10, 1500, 'GET', 'https://staging.acme.dev/api/flags', 200),
      ]),
    );
    const slow = a.issues.find((i) => i.kind === 'slow')!;
    expect(slow.title).toBe('GET /api/flags');
    expect(slow.reasons[0].text).toBe('Took 1.5 s');
    expect(a.medianRequestMs).toBeUndefined();
  });

  it('phrases unhandled rejections naturally in the summary', () => {
    const a = analyze(
      investigation([
        log(100, 'error', 'Unhandled promise rejection: TypeError: x is undefined', {
          source: 'exception',
          stack: [{ url: 'https://staging.acme.dev/app.js', line: 3, column: 1 }],
        }),
      ]),
    );
    expect(a.summary).toBe('The page had an unhandled promise rejection: TypeError: x is undefined (app.js:3).');
  });

  it('prefers a request whose initiator shares a script with the error stack', () => {
    const a = analyze(
      investigation([
        request(100, 100, 'GET', 'https://staging.acme.dev/api/a', 500, {
          initiatorScripts: ['https://staging.acme.dev/a.js'],
        }),
        request(150, 100, 'GET', 'https://staging.acme.dev/api/b', 500, {
          initiatorScripts: ['https://staging.acme.dev/b.js'],
        }),
        log(400, 'error', 'boom', {
          source: 'exception',
          stack: [{ url: 'https://staging.acme.dev/a.js', line: 1, column: 1 }],
        }),
      ]),
    );
    const err = a.issues.find((i) => i.kind === 'error')!;
    expect(a.issuesById[err.causedBy!].title).toBe('GET /api/a');
  });
});
