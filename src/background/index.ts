import { CdpEventMapper } from '../capture/cdpMapper';
import { BINDING_NAME } from '../capture/probeProtocol';
import type { Investigation } from '../core/types';
import { PORT_NAME, type BackgroundMessage, type UiCommand } from '../shared/messages';
import { createSession, restoreSession, toTabState, upsertEvents, type Session } from './sessions';

/**
 * Background service worker.
 *
 * Owns one investigation per tab. While recording, it is attached to the tab
 * with `chrome.debugger` (Chrome shows a "BugTrail started debugging this
 * browser" bar — that is expected) and feeds every CDP event through
 * `CdpEventMapper`. Extension pages subscribe over a port and get the full
 * tab state pushed to them, throttled.
 */

const PROTOCOL_VERSION = '1.3';
const STORAGE_KEY = 'bugtrail.sessions';
const BROADCAST_MS = 150;
const PERSIST_MS = 1000;

const sessions = new Map<number, Session>();
const mappers = new Map<number, CdpEventMapper>();
const subscribers = new Map<number, Set<chrome.runtime.Port>>();
const broadcastTimers = new Map<number, ReturnType<typeof setTimeout>>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let probeSource: Promise<string> | undefined;

const ready = restore();

// ---------------------------------------------------------------------------
// Persistence: survive service-worker restarts within the browser session.

async function restore(): Promise<void> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const list = (stored[STORAGE_KEY] as Investigation[] | undefined) ?? [];
  for (const inv of list) {
    const session = restoreSession(inv);
    // A restarted worker has lost its debugger attachment; show it as stopped.
    session.inv.stoppedAt ??= Date.now();
    sessions.set(inv.tabId, session);
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const list = [...sessions.values()].map((s) => s.inv);
    chrome.storage.session.set({ [STORAGE_KEY]: list }).catch((err) => {
      // Quota exceeded on huge sessions: keep working in memory.
      console.warn('[BugTrail] could not persist sessions', err);
    });
  }, PERSIST_MS);
}

// ---------------------------------------------------------------------------
// Broadcasting state to extension pages.

function send(port: chrome.runtime.Port, tabId: number): void {
  const msg: BackgroundMessage = { type: 'state', state: toTabState(tabId, sessions.get(tabId)) };
  try {
    port.postMessage(msg);
  } catch {
    subscribers.get(tabId)?.delete(port);
  }
}

function scheduleBroadcast(tabId: number): void {
  if (broadcastTimers.has(tabId)) return;
  broadcastTimers.set(
    tabId,
    setTimeout(() => {
      broadcastTimers.delete(tabId);
      for (const port of subscribers.get(tabId) ?? []) send(port, tabId);
    }, BROADCAST_MS),
  );
  schedulePersist();
}

function updateBadge(tabId: number): void {
  const recording = sessions.get(tabId)?.recording ?? false;
  chrome.action.setBadgeText({ tabId, text: recording ? 'REC' : '' }).catch(() => {});
  if (recording) chrome.action.setBadgeBackgroundColor({ tabId, color: '#E5483B' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Debugger lifecycle.

function loadProbe(): Promise<string> {
  probeSource ??= fetch(chrome.runtime.getURL('probe.js')).then((r) => r.text());
  return probeSource;
}

async function cdp<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
}

async function start(tabId: number, title: string): Promise<void> {
  const existing = sessions.get(tabId);
  if (existing?.recording) return;

  const startedAt = Date.now();
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (err) {
    const session = existing ?? createSession(tabId, title, '', startedAt);
    session.recording = false;
    session.error = `Could not attach to this tab: ${(err as Error).message}`;
    sessions.set(tabId, session);
    scheduleBroadcast(tabId);
    return;
  }

  let pageUrl = '';
  try {
    const res = await cdp<{ result: { value?: string } }>(tabId, 'Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    pageUrl = res.result.value ?? '';
  } catch {
    /* pages like chrome:// can't be evaluated; capture still works */
  }

  const session = createSession(tabId, title, pageUrl, startedAt);
  const mapper = new CdpEventMapper(startedAt);
  sessions.set(tabId, session);
  mappers.set(tabId, mapper);
  updateBadge(tabId);
  scheduleBroadcast(tabId);

  try {
    await cdp(tabId, 'Network.enable', { maxPostDataSize: 16 * 1024 });
    await cdp(tabId, 'Page.enable');
    const tree = await cdp<{ frameTree: { frame: { id: string } } }>(tabId, 'Page.getFrameTree');
    mapper.setMainFrame(tree.frameTree.frame.id);
    await cdp(tabId, 'Log.enable');
    await cdp(tabId, 'Runtime.enable');
    await cdp(tabId, 'Runtime.addBinding', { name: BINDING_NAME });
    const probe = await loadProbe();
    await cdp(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source: probe });
    await cdp(tabId, 'Runtime.evaluate', { expression: probe, silent: true });
  } catch (err) {
    session.error = `Recording started with limited capture: ${(err as Error).message}`;
    scheduleBroadcast(tabId);
  }
}

async function stop(tabId: number): Promise<void> {
  const session = sessions.get(tabId);
  if (session) {
    session.recording = false;
    session.inv.stoppedAt = Date.now();
  }
  mappers.delete(tabId);
  updateBadge(tabId);
  scheduleBroadcast(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already detached */
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const session = sessions.get(tabId);
  const mapper = mappers.get(tabId);
  if (!session?.recording || !mapper) return;

  const result = mapper.handle(method, (params ?? {}) as Record<string, unknown>);
  if (upsertEvents(session, result.events)) scheduleBroadcast(tabId);

  if (result.fetchBodyFor) {
    const requestId = result.fetchBodyFor;
    cdp<{ body: string; base64Encoded: boolean }>(tabId, 'Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const updated = mapper.attachBody(requestId, body, base64Encoded);
        if (updated && upsertEvents(session, [updated])) scheduleBroadcast(tabId);
      })
      .catch(() => {
        /* body evicted or unavailable */
      });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const session = sessions.get(tabId);
  if (session?.recording) {
    session.recording = false;
    session.inv.stoppedAt = Date.now();
    if (reason === 'canceled_by_user') session.error = 'Recording stopped from the browser’s debugging bar.';
    else if (reason !== 'target_closed') session.error = `Recording stopped (${reason}).`;
  }
  mappers.delete(tabId);
  updateBadge(tabId);
  scheduleBroadcast(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  mappers.delete(tabId);
  subscribers.delete(tabId);
  schedulePersist();
});

// ---------------------------------------------------------------------------
// Commands from extension pages.

async function handle(cmd: UiCommand, port: chrome.runtime.Port): Promise<void> {
  await ready;
  const { tabId } = cmd;
  switch (cmd.type) {
    case 'subscribe': {
      let set = subscribers.get(tabId);
      if (!set) subscribers.set(tabId, (set = new Set()));
      set.add(port);
      send(port, tabId);
      return;
    }
    case 'start':
      return start(tabId, cmd.title);
    case 'stop':
      return stop(tabId);
    case 'clear':
      if (sessions.get(tabId)?.recording) await stop(tabId);
      sessions.delete(tabId);
      scheduleBroadcast(tabId);
      return;
    case 'rename': {
      const s = sessions.get(tabId);
      if (s) s.inv.title = cmd.title.trim() || s.inv.title;
      scheduleBroadcast(tabId);
      return;
    }
    case 'mute':
    case 'unmute': {
      const s = sessions.get(tabId);
      if (!s) return;
      const set = new Set(s.inv.mutedFingerprints);
      if (cmd.type === 'mute') set.add(cmd.fingerprint);
      else set.delete(cmd.fingerprint);
      s.inv.mutedFingerprints = [...set];
      scheduleBroadcast(tabId);
      return;
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  port.onMessage.addListener((cmd: UiCommand) => {
    handle(cmd, port).catch((err) => console.error('[BugTrail]', err));
  });
  port.onDisconnect.addListener(() => {
    for (const set of subscribers.values()) set.delete(port);
  });
});
