import type { Analysis, Issue } from '../../core/analyze';
import { toCurl } from '../../core/curl';
import { formatDuration, formatOffset, requestDuration } from '../../core/describe';
import type { ConsoleEvent, RequestEvent } from '../../core/types';
import { shortLocation } from '../../core/url';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';

interface Props {
  issue: Issue;
  analysis: Analysis;
  startedAt: number;
  onSelect: (id: string) => void;
  onMute: (id: string) => void;
}

const BODY_PREVIEW = 4000;

/** `https://app.dev/js/auth.ts:31` → `auth.ts:31`. */
function initiatorLabel(initiator: string): string {
  const at = initiator.lastIndexOf(':');
  const line = Number(initiator.slice(at + 1));
  return at > 0 && Number.isInteger(line) ? shortLocation(initiator.slice(0, at), line) : shortLocation(initiator);
}

function RequestFacts({ req }: { req: RequestEvent }) {
  const d = requestDuration(req);
  const body = req.responseBody;
  return (
    <>
      <dl className="facts">
        <dt>URL</dt>
        <dd className="mono wrap">{req.url}</dd>
        <dt>Result</dt>
        <dd className="mono">
          {req.failure?.kind === 'network'
            ? (req.failure.corsError ?? req.failure.blockedReason ?? req.failure.errorText)
            : `${req.status ?? '—'} ${req.statusText ?? ''}`}
          {d !== undefined ? ` · ${formatDuration(d)}` : ''}
        </dd>
        {req.initiator ? (
          <>
            <dt>Started by</dt>
            <dd className="mono wrap">{initiatorLabel(req.initiator)}</dd>
          </>
        ) : null}
      </dl>
      {body ? (
        <pre className="code" aria-label="Response body">
          {body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW)}\n…` : body}
        </pre>
      ) : null}
      <div className="detail-actions">
        <CopyButton text={() => toCurl(req)} label="Copy as cURL" />
      </div>
    </>
  );
}

function ConsoleFacts({ event }: { event: ConsoleEvent }) {
  const frames = (event.stack ?? []).slice(0, 6);
  return (
    <>
      <pre className="code">{event.text}</pre>
      {frames.length ? (
        <ol className="stack" aria-label="Stack">
          {frames.map((f, i) => (
            <li key={i} className="mono">
              <span>{f.functionName || '(anonymous)'}</span>{' '}
              <span className="muted">{shortLocation(f.url, f.line)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

export function IssueDetail({ issue, analysis, startedAt, onSelect, onMute }: Props) {
  const first = issue.occurrences[0];
  const cause = issue.causedBy ? analysis.issuesById[issue.causedBy] : undefined;
  const effects = issue.causes.map((id) => analysis.issuesById[id]).filter(Boolean);
  return (
    <div className="detail">
      <div className="detail-why">
        <span className="detail-heading">
          Why it scores {issue.score}
          <span className="muted"> · first seen {formatOffset(issue.time - startedAt)}</span>
        </span>
        <ul className="reasons">
          {issue.reasons.map((r, i) => (
            <li key={i}>
              <span className={`pts mono ${r.points < 0 ? 'neg' : ''}`}>
                {r.points > 0 ? `+${r.points}` : r.points}
              </span>
              {r.text}
            </li>
          ))}
        </ul>
        {cause ? (
          <button type="button" className="link" onClick={() => onSelect(cause.id)}>
            Probably caused by <span className="mono">{cause.title}</span> ({cause.tag})
          </button>
        ) : null}
        {effects.map((e) => (
          <button key={e.id} type="button" className="link" onClick={() => onSelect(e.id)}>
            Probably caused <span className="mono">{e.title}</span>
          </button>
        ))}
      </div>
      <div className="detail-body">
        {first.type === 'request' ? <RequestFacts req={first} /> : null}
        {first.type === 'console' ? <ConsoleFacts event={first} /> : null}
        <div className="detail-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onMute(issue.id)}>
            <Icon name="mute" size={14} /> Mute this pattern
          </button>
        </div>
      </div>
    </div>
  );
}
