import { useEffect, useState } from 'react';
import { App } from '../App';
import { mount } from './mount';

/**
 * The side panel follows the active tab of its window. `?tabId=` pins it to a
 * specific tab (used by the end-to-end test, which opens the panel as a page).
 */
function SidePanel() {
  const pinned = Number(new URLSearchParams(location.search).get('tabId')) || undefined;
  const [tabId, setTabId] = useState<number | undefined>(pinned);

  useEffect(() => {
    if (pinned) return;
    let windowId: number | undefined;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      windowId = tab?.windowId;
      setTabId(tab?.id);
    });
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (windowId === undefined || info.windowId === windowId) setTabId(info.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, [pinned]);

  return <App tabId={tabId} surface="sidepanel" />;
}

mount(<SidePanel />);
