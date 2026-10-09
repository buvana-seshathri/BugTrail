import { useEffect, useMemo, useState } from 'react';
import { analyze, type IssueKind } from '../core/analyze';
import { formatOffset } from '../core/describe';
import { Icon } from './components/Icon';
import { LogoMark, Wordmark } from './components/Logo';
import { cssId, StoryView, type StoryFilters } from './components/StoryView';
import { SummaryPanel } from './components/SummaryPanel';
import { useTabState } from './hooks/useTabState';
import { useTheme } from './hooks/useTheme';

export type Surface = 'sidepanel' | 'devtools';

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const label = pref === 'system' ? 'Theme: match system' : pref === 'light' ? 'Theme: light' : 'Theme: dark';
  return (
    <button type="button" className="icon-btn" onClick={cycle} title={label} aria-label={label}>
      <Icon name={pref === 'system' ? 'auto' : pref === 'light' ? 'sun' : 'moon'} />
    </button>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StartScreen({ onStart, error }: { onStart: (title: string) => void; error?: string }) {
  const [title, setTitle] = useState('');
  return (
    <div className="start">
      <header className="start-header">
        <LogoMark size={28} />
        <Wordmark size={20} />
        <span className="spacer" />
        <ThemeToggle />
      </header>
      <form
        className="card start-card"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(title);
        }}
      >
        <label className="field">
          <span className="field-label">What are you testing?</span>
          <input
            className="input input-display"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Login is broken"
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-primary btn-lg">
          <Icon name="play" size={14} /> Start investigation
        </button>
        {error ? <p className="notice notice-err">{error}</p> : null}
      </form>
      <ol className="start-steps">
        <li>
          <b>Start</b>, then reproduce the problem in the page.
        </li>
        <li>BugTrail ties each failed request and error to the action that caused it, and ranks them by impact.</li>
        <li>
          <b>Copy the report</b> and paste it into your bug tracker.
        </li>
      </ol>
      <p className="fine">
        <Icon name="lock" size={12} /> While recording, Chrome shows a “BugTrail started debugging this browser” bar.
        Everything stays on your machine.
      </p>
    </div>
  );
}

const CHIPS: {
  kind: IssueKind;
  label: string;
  count: (c: ReturnType<typeof analyze>['counts']) => number;
  tone: string;
}[] = [
  { kind: 'request', label: 'Failed', count: (c) => c.failed, tone: 'err' },
  { kind: 'error', label: 'Errors', count: (c) => c.errors, tone: 'err' },
  { kind: 'slow', label: 'Slow', count: (c) => c.slow, tone: 'slow' },
  { kind: 'warning', label: 'Warnings', count: (c) => c.warnings, tone: 'warn' },
];

export function App({ tabId, surface }: { tabId: number | undefined; surface: Surface }) {
  const { state, send } = useTabState(tabId);
  const inv = state?.investigation ?? null;
  const analysis = useMemo(() => (inv ? analyze(inv) : null), [inv]);
  const [filters, setFilters] = useState<StoryFilters>({
    kinds: new Set<IssueKind>(['request', 'error', 'slow', 'warning']),
    showNoise: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const now = useNow(!!state?.recording);

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id)
      requestAnimationFrame(() =>
        document.getElementById(`issue-${cssId(id)}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
  };

  if (tabId === undefined) {
    return <div className="center muted">Open BugTrail on a regular web page tab.</div>;
  }
  if (!state) return <div className="center muted">Connecting…</div>;
  if (!inv || !analysis) {
    return <StartScreen error={state.error} onStart={(title) => send({ type: 'start', title })} />;
  }

  const elapsed = (inv.stoppedAt ?? now) - inv.startedAt;
  const toggleKind = (kind: IssueKind) =>
    setFilters((f) => {
      const kinds = new Set(f.kinds);
      if (kinds.has(kind)) kinds.delete(kind);
      else kinds.add(kind);
      return { ...f, kinds };
    });

  return (
    <div className={`app surface-${surface}`}>
      <header className="topbar">
        <LogoMark size={24} title="BugTrail" />
        <div className="topbar-title">
          <input
            className="title-input"
            aria-label="Investigation name"
            value={draftTitle ?? inv.title}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => {
              if (draftTitle !== null && draftTitle.trim() && draftTitle !== inv.title)
                send({ type: 'rename', title: draftTitle });
              setDraftTitle(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="topbar-status">
            {state.recording ? (
              <span className="rec">
                <span className="rec-dot" /> Recording {formatOffset(elapsed).replace(/\.\d$/, '')}
              </span>
            ) : (
              <span className="muted">Stopped · {formatOffset(elapsed).replace(/\.\d$/, '')}</span>
            )}
            {inv.pageUrl ? (
              <span className="muted mono topbar-url"> · {inv.pageUrl.replace(/^https?:\/\//, '')}</span>
            ) : null}
          </span>
        </div>
        <div className="chips" role="group" aria-label="Show">
          {CHIPS.map((c) => (
            <button
              key={c.kind}
              type="button"
              className={`chip tone-${c.tone}`}
              aria-pressed={filters.kinds.has(c.kind)}
              onClick={() => toggleKind(c.kind)}
            >
              {c.label} <span className="mono">{c.count(analysis.counts)}</span>
            </button>
          ))}
          <button
            type="button"
            className="chip tone-muted"
            aria-pressed={filters.showNoise}
            onClick={() => setFilters((f) => ({ ...f, showNoise: !f.showNoise }))}
            title="Known noise: favicon 404s, ad-blocker failures, dev-only warnings…"
          >
            Noise <span className="mono">{analysis.counts.noise}</span>
          </button>
        </div>
        <div className="topbar-actions">
          {state.recording ? (
            <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'stop' })}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'clear' })}>
              New investigation
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>
      {state.error ? <p className="notice notice-err banner">{state.error}</p> : null}
      {state.truncated ? (
        <p className="notice banner">Event limit reached; newer events are not being recorded.</p>
      ) : null}
      <div className="layout">
        <main className="layout-main">
          <StoryView
            analysis={analysis}
            startedAt={inv.startedAt}
            recording={state.recording}
            filters={filters}
            selectedId={selectedId}
            onSelect={select}
            onMute={(id) => send({ type: 'mute', fingerprint: id })}
          />
          {inv.mutedFingerprints.length ? (
            <div className="muted-list">
              <span className="eyebrow">Muted patterns</span>
              {inv.mutedFingerprints.map((fp) => (
                <button
                  key={fp}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => send({ type: 'unmute', fingerprint: fp })}
                >
                  <Icon name="unmute" size={14} /> {analysis.issuesById[fp]?.title ?? fp}
                </button>
              ))}
            </div>
          ) : null}
        </main>
        <SummaryPanel analysis={analysis} investigation={inv} onSelect={select} />
      </div>
    </div>
  );
}
