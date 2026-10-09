// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeElement, installProbe } from '../src/capture/probe';
import type { ProbePayload } from '../src/capture/probeProtocol';

describe('probe', () => {
  let sent: ProbePayload[];
  let uninstall: () => void;

  beforeEach(() => {
    document.body.innerHTML = `
      <form id="signin">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
        <input name="password" type="password" placeholder="Password" />
        <button type="submit"><span>Sign in</span></button>
      </form>
      <div class="card x1234567"><a href="#more" aria-label="Read more">…</a></div>`;
    sent = [];
    uninstall = installProbe(window, (p) => sent.push(p));
  });
  afterEach(() => uninstall());

  it('reports clicks on the interactive element, not the inner span', () => {
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      v: 1,
      kind: 'click',
      target: { selector: 'form#signin › button[type=submit]', label: 'Sign in', tag: 'button' },
    });
  });

  it('labels fields from <label>, placeholder or name — never from the typed value', () => {
    const email = document.querySelector<HTMLInputElement>('#email')!;
    email.value = 'secret@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    const password = document.querySelector<HTMLInputElement>('input[name=password]')!;
    password.value = 'hunter2';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sent.map((p) => p.target?.label)).toEqual(['Email', 'Password']);
    expect(JSON.stringify(sent)).not.toMatch(/secret@example|hunter2/);
  });

  it('emits one input event per burst of typing', () => {
    const email = document.querySelector('#email')!;
    for (let i = 0; i < 5; i++) email.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sent.filter((p) => p.kind === 'input')).toHaveLength(1);
  });

  it('does not report the click that focuses a text field', () => {
    document.querySelector('#email')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent).toHaveLength(0);
  });

  it('reports submits and Enter key presses', () => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    document.querySelector('#email')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.querySelector('#email')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(sent.map((p) => [p.kind, p.key])).toEqual([
      ['submit', undefined],
      ['keypress', 'Enter'],
    ]);
  });

  it('does not report the submit that a click on the submit button causes', () => {
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(sent.map((p) => p.kind)).toEqual(['click']);
  });

  it('installs only once per window', () => {
    const extra: ProbePayload[] = [];
    const again = installProbe(window, (p) => extra.push(p));
    document.querySelector('button')!.click();
    expect(extra).toHaveLength(0);
    again();
  });

  it('skips generated-looking class names and uses aria-label', () => {
    expect(describeElement(document.querySelector('a')!)).toEqual({ selector: 'a', label: 'Read more', tag: 'a' });
    expect(describeElement(document.querySelector('.card')!).selector).toBe('div.card');
  });
});
