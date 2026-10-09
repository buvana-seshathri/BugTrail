import type { Analysis } from '../../core/analyze';
import { toMarkdown } from '../../core/markdown';
import type { Investigation } from '../../core/types';
import { CopyButton } from './CopyButton';
import { tone } from './StoryView';

interface Props {
  analysis: Analysis;
  investigation: Investigation;
  onSelect: (id: string) => void;
}

export function SummaryPanel({ analysis, investigation, onSelect }: Props) {
  const top = analysis.issues.filter((i) => !i.noise).slice(0, 3);
  return (
    <aside className="summary" aria-label="Summary">
      <section>
        <h2 className="eyebrow">What happened</h2>
        <p className="summary-text">
          {analysis.summary ??
            (investigation.events.length
              ? 'No failures so far. Problems will appear here as they happen.'
              : 'Nothing recorded yet.')}
        </p>
      </section>
      {top.length ? (
        <section>
          <h2 className="eyebrow">Top issues</h2>
          <ul className="top-issues">
            {top.map((i) => (
              <li key={i.id}>
                <button type="button" className={`top-issue tone-${tone(i)}`} onClick={() => onSelect(i.id)}>
                  <span className="score-box mono">{i.score}</span>
                  <span className="mono top-issue-title">
                    {i.title}
                    {i.kind === 'request' ? ` → ${i.tag}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="summary-share">
        <CopyButton primary label="Copy report as Markdown" text={() => toMarkdown(investigation, analysis)} />
        <p className="fine">Tokens, cookies and password fields are redacted. Nothing is uploaded.</p>
      </section>
    </aside>
  );
}
