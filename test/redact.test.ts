import { describe, expect, it } from 'vitest';
import { toCurl } from '../src/core/curl';
import { analyze } from '../src/core/analyze';
import { toMarkdown } from '../src/core/markdown';
import { redactBody, redactHeaders, redactUrl, REDACTED } from '../src/core/redact';
import { loginScenario, request } from './fixtures';

describe('redaction', () => {
  it('redacts sensitive headers regardless of case', () => {
    expect(
      redactHeaders({ Authorization: 'Bearer x', Cookie: 'a=b', 'Content-Type': 'json', 'X-Api-Key': 'k' }),
    ).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      'Content-Type': 'json',
      'X-Api-Key': REDACTED,
    });
  });

  it('redacts nested JSON keys but keeps harmless look-alikes', () => {
    const out = JSON.parse(
      redactBody('{"user":{"password":"p","author":"Dana"},"tokens":[{"access_token":"t"}],"spinner":true}')!,
    );
    expect(out).toEqual({ user: { password: REDACTED, author: 'Dana' }, tokens: REDACTED, spinner: true });
  });

  it('redacts form-encoded and query-string secrets', () => {
    expect(redactBody('user=dana&password=hunter2')).toBe(`user=dana&password=${encodeURIComponent(REDACTED)}`);
    expect(redactUrl('https://a.dev/cb?code=1&access_token=abc')).toBe(
      `https://a.dev/cb?code=1&access_token=${encodeURIComponent(REDACTED)}`,
    );
    expect(redactUrl('https://user:pw@a.dev/')).toBe('https://a.dev/');
  });

  it('masks key/value pairs in non-JSON text as a last resort', () => {
    expect(redactBody('{"password": "abc", truncated')).toContain(`"password": "${REDACTED}"`);
  });
});

describe('exports never leak secrets', () => {
  const inv = loginScenario();
  const md = toMarkdown(inv, analyze(inv));

  it('markdown report', () => {
    expect(md).toContain('# Login is broken');
    expect(md).toContain('## Steps to reproduce');
    expect(md).toContain('POST /api/v2/auth/login');
    expect(md).not.toContain('hunter2');
    expect(md).not.toContain('Bearer abc.def');
  });

  it('curl command', () => {
    const req = request(0, 10, 'POST', 'https://a.dev/login?token=zzz', 500, {
      requestHeaders: { authorization: 'Bearer x', 'content-type': 'application/json', ':authority': 'a.dev' },
      postData: '{"password":"p","email":"e"}',
    });
    const curl = toCurl(req);
    expect(curl).toContain('-X POST');
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).not.toMatch(/Bearer x|zzz|"p"|:authority/);
  });
});
