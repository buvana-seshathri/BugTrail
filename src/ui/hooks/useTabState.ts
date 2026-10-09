import { useCallback, useEffect, useRef, useState } from 'react';
import { PORT_NAME, type BackgroundMessage, type TabState, type UiCommand } from '../../shared/messages';

type Command = UiCommand extends infer C ? (C extends { tabId: number } ? Omit<C, 'tabId'> : never) : never;

/**
 * Subscribes to the background worker for one tab and returns its live state
 * plus a `send` function for commands. Reconnects if the worker restarts.
 */
export function useTabState(tabId: number | undefined) {
  const [state, setState] = useState<TabState | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    if (tabId === undefined) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener((msg: BackgroundMessage) => {
        if (msg.type === 'state' && msg.state.tabId === tabId) setState(msg.state);
      });
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!disposed) retry = setTimeout(connect, 500);
      });
      port.postMessage({ type: 'subscribe', tabId } satisfies UiCommand);
    };
    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [tabId]);

  const send = useCallback(
    (cmd: Command) => {
      if (tabId === undefined) return;
      portRef.current?.postMessage({ ...cmd, tabId } as UiCommand);
    },
    [tabId],
  );

  return { state, send };
}
