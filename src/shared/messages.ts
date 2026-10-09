import type { Investigation } from '../core/types';

/**
 * The protocol between extension pages (side panel, DevTools panel, popup) and
 * the background service worker. Pages open a long-lived port named
 * `PORT_NAME`, send `UiCommand`s and receive `BackgroundMessage`s.
 */

export const PORT_NAME = 'bugtrail-ui';

export type UiCommand =
  | { type: 'subscribe'; tabId: number }
  | { type: 'start'; tabId: number; title: string }
  | { type: 'stop'; tabId: number }
  | { type: 'clear'; tabId: number }
  | { type: 'rename'; tabId: number; title: string }
  | { type: 'mute'; tabId: number; fingerprint: string }
  | { type: 'unmute'; tabId: number; fingerprint: string };

export interface TabState {
  tabId: number;
  investigation: Investigation | null;
  recording: boolean;
  /** Set when attaching failed or the debugger was detached unexpectedly. */
  error?: string;
  /** True once the event cap was reached and new events are being dropped. */
  truncated?: boolean;
}

export type BackgroundMessage = { type: 'state'; state: TabState };
