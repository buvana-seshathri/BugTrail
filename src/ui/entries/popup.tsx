import { useEffect, useMemo, useState } from 'react';
import { analyze } from '../../core/analyze';
import { Icon } from '../components/Icon';
import { LogoMark, Wordmark } from '../components/Logo';
import { useTabState } from '../hooks/useTabState';
import { mount } from './mount';

/** Toolbar popup: status of the current tab and the quickest way to start. */
function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | undefined>();
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t));
  }, []);
  const { state, send } = useTabState(tab?.id);
  const inv = state?.investigation ?? null;
  const analysis = useMemo(() => (inv ? analyze(inv) : null), [inv]);

  const openSidePanel = async () => {
    if (tab?.id === undefined) return;
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  };

  const startAndOpen = async () => {
    if (tab?.id === undefined) return;
    // Open first: sidePanel.open must run while the click still counts as a user gesture.
    const opening = chrome.sidePanel.open({ tabId: tab.id });
    send({ type: 'start', title: '' });
    await opening;
    window.close();
  };

  return (
    <div className="popup">
      <header className="start-header">
        <LogoMark size={26} />
        <Wordmark size={19} />
      </header>
      {inv && analysis ? (
        <div className="card popup-card">
          <div className="popup-row">
            <span className="popup-title">{inv.title}</span>
            {state?.recording ? (
              <span className="rec">
                <span className="rec-dot" /> REC
              </span>
            ) : (
              <span className="muted">stopped</span>
            )}
          </div>
          <div className="popup-stats">
            <span className="tone-err">
              <b className="mono">{analysis.counts.failed}</b> failed
            </span>
            <span className="tone-err">
              <b className="mono">{analysis.counts.errors}</b> errors
            </span>
            <span className="tone-slow">
              <b className="mono">{analysis.counts.slow}</b> slow
            </span>
          </div>
          {analysis.summary ? <p className="popup-summary">{analysis.summary}</p> : null}
        </div>
      ) : (
        <p className="muted popup-intro">
          Record what happens while you reproduce a bug: failed requests, errors and the actions that caused them.
        </p>
      )}
      <div className="popup-actions">
        {!inv || !state?.recording ? (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={startAndOpen}
            disabled={tab?.id === undefined}
          >
            <Icon name="play" size={14} /> Start investigation
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={openSidePanel} disabled={tab?.id === undefined}>
          <Icon name="sidePanel" size={14} /> Open side panel
        </button>
        <p className="fine">Prefer DevTools? Press F12 and open the BugTrail tab.</p>
      </div>
      <p className="fine">
        <Icon name="lock" size={12} /> Local only. Nothing leaves your browser unless you copy it.
      </p>
    </div>
  );
}

mount(<Popup />);
