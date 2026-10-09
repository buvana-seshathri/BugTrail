import type { Investigation, TrailEvent } from '../core/types';
import type { TabState } from '../shared/messages';

/**
 * In-memory investigations, one per tab, plus the bookkeeping to upsert events
 * in O(1). Independent of `chrome.*` so it can be unit-tested.
 */

export const MAX_EVENTS = 5000;

export interface Session {
  inv: Investigation;
  recording: boolean;
  error?: string;
  truncated?: boolean;
  index: Map<string, number>;
}

let invCounter = 0;

export function createSession(tabId: number, title: string, pageUrl: string, now = Date.now()): Session {
  return {
    inv: {
      id: `inv-${now.toString(36)}-${(invCounter++).toString(36)}`,
      title: title.trim() || 'Untitled investigation',
      tabId,
      pageUrl,
      startedAt: now,
      events: [],
      mutedFingerprints: [],
    },
    recording: true,
    index: new Map(),
  };
}

/** Inserts or replaces events by id. Returns false if nothing changed. */
export function upsertEvents(session: Session, events: TrailEvent[]): boolean {
  let changed = false;
  for (const e of events) {
    const at = session.index.get(e.id);
    if (at !== undefined) {
      session.inv.events[at] = { ...e };
      changed = true;
    } else if (session.inv.events.length < MAX_EVENTS) {
      session.index.set(e.id, session.inv.events.length);
      session.inv.events.push({ ...e });
      changed = true;
    } else {
      session.truncated = true;
    }
  }
  return changed;
}

export function restoreSession(inv: Investigation): Session {
  return {
    inv,
    recording: false,
    index: new Map(inv.events.map((e, i) => [e.id, i])),
  };
}

export function toTabState(tabId: number, session: Session | undefined): TabState {
  return {
    tabId,
    investigation: session?.inv ?? null,
    recording: session?.recording ?? false,
    error: session?.error,
    truncated: session?.truncated,
  };
}
