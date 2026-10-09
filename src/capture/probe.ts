import type { ElementRef } from '../core/types';
import type { ProbePayload } from './probeProtocol';

/**
 * The page probe: a tiny script BugTrail injects into the inspected page (via
 * CDP, so no content-script host permissions are needed) to record what the
 * user did — clicks, typing, submits, Enter/Escape — so problems can be tied
 * to the action that caused them.
 *
 * It runs in the page's own JavaScript world, so it must be self-contained:
 * `vite.probe.config.ts` bundles this file into `probe.js` as an IIFE.
 */

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [contenteditable="true"]';

const MAX_LABEL = 60;

function clean(text: string | null | undefined): string | undefined {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/** One selector step: `button#save`, `input[name=email]`, `div.card`. */
export function selectorStep(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && !/\d{3,}/.test(el.id)) return `${tag}#${cssEscape(el.id)}`;
  for (const attr of ['data-testid', 'data-test', 'data-cy', 'name']) {
    const v = el.getAttribute(attr);
    if (v) return `${tag}[${attr}=${v}]`;
  }
  const type = el.getAttribute('type');
  if (tag === 'input' || tag === 'button') {
    if (type) return `${tag}[type=${type}]`;
  }
  const classes = [...el.classList].filter((c) => !/\d{3,}|^(css|sc|jsx)-/.test(c)).slice(0, 2);
  return classes.length ? `${tag}.${classes.map(cssEscape).join('.')}` : tag;
}

/** A short, readable path: nearest landmark with an id (or the form) › the element. */
export function describeSelector(el: Element): string {
  const step = selectorStep(el);
  if (el.id) return step;
  let parent = el.parentElement;
  while (parent && parent !== el.ownerDocument.body) {
    if (parent.id || parent.tagName === 'FORM') return `${selectorStep(parent)} › ${step}`;
    parent = parent.parentElement;
  }
  return step;
}

/** The name a person would use for the element. Never reads what was typed into a field. */
export function accessibleLabel(el: Element): string | undefined {
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (clean(text)) return clean(text);
  }
  const tag = el.tagName.toLowerCase();
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (isField) {
    const input = el as HTMLInputElement;
    if (input.type === 'submit' || input.type === 'button') return clean(input.value);
    const labels = input.labels ? [...input.labels] : [];
    const fromLabel = clean(labels.map((l) => l.textContent).join(' '));
    return fromLabel ?? clean(el.getAttribute('placeholder')) ?? clean(el.getAttribute('name')) ?? undefined;
  }
  return clean((el as HTMLElement).innerText ?? el.textContent) ?? clean(el.getAttribute('title')) ?? undefined;
}

export function describeElement(el: Element): ElementRef {
  return { selector: describeSelector(el), label: accessibleLabel(el), tag: el.tagName.toLowerCase() };
}

type Send = (payload: ProbePayload) => void;

/** Installs listeners on `win`. Returns an uninstall function (used by tests). */
export function installProbe(win: Window, send: Send): () => void {
  const flag = '__bugtrailProbe';
  const w = win as unknown as Record<string, unknown>;
  if (w[flag]) return () => {};
  w[flag] = true;

  const doc = win.document;
  // The last reported element, so a submit caused by that click/Enter isn't reported twice.
  let last: { el: Element | null; time: number } = { el: null, time: 0 };
  const emit = (kind: ProbePayload['kind'], el: Element | null, extra: Partial<ProbePayload> = {}) => {
    last = { el, time: Date.now() };
    try {
      send({
        v: 1,
        time: Date.now(),
        kind,
        url: win.location.href,
        target: el ? describeElement(el) : undefined,
        ...extra,
      });
    } catch {
      // Never let the probe break the page.
    }
  };

  const lastInput = new WeakMap<Element, number>();

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const el = target.closest(INTERACTIVE) ?? target;
    // Typing into a field starts with a click on it; the input event says more.
    const tag = el.tagName.toLowerCase();
    if (
      (tag === 'input' && !/^(submit|button|checkbox|radio|reset|file|image)$/.test((el as HTMLInputElement).type)) ||
      tag === 'textarea'
    )
      return;
    emit('click', el);
  };
  const onInput = (e: Event) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const now = Date.now();
    // One event per field per burst of typing.
    if (now - (lastInput.get(el) ?? 0) < 1500) {
      lastInput.set(el, now);
      return;
    }
    lastInput.set(el, now);
    emit('input', el);
  };
  const onSubmit = (e: Event) => {
    const form = e.target instanceof Element ? e.target : null;
    if (form && last.el && form.contains(last.el) && Date.now() - last.time < 1000) return;
    emit('submit', form);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    emit('keypress', e.target instanceof Element ? e.target : null, { key: e.key });
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('keydown', onKey, true);
    delete w[flag];
  };
}
