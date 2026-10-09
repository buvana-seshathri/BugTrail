import type { Analysis, Chapter, Issue, IssueKind } from '../../core/analyze';
import { formatOffset } from '../../core/describe';
import { Icon } from './Icon';
import { IssueDetail } from './IssueDetail';

export interface StoryFilters {
  kinds: Set<IssueKind>;
  showNoise: boolean;
}

interface Props {
  analysis: Analysis;
  startedAt: number;
  recording: boolean;
  filters: StoryFilters;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMute: (id: string) => void;
}

const KIND_LABEL: Record<IssueKind, string> = {
  request: 'Request',
  error: 'Error',
  slow: 'Slow',
  warning: 'Warning',
};

export function tone(issue: Issue): 'err' | 'warn' | 'slow' | 'muted' {
  if (issue.noise) return 'muted';
  if (issue.kind === 'slow') return 'slow';
  if (issue.kind === 'warning') return 'warn';
  if (issue.kind === 'request' && issue.severity !== 'critical' && issue.severity !== 'high') return 'warn';
  return 'err';
}

function visible(issue: Issue, filters: StoryFilters): boolean {
  if (issue.noise) return filters.showNoise;
  return filters.kinds.has(issue.kind);
}

function ChapterBlock({
  chapter,
  index,
  isLast,
  props,
}: {
  chapter: Chapter;
  index: number;
  isLast: boolean;
  props: Props;
}) {
  const { analysis, startedAt, filters, selectedId, onSelect, onMute, recording } = props;
  const rows = chapter.rows.filter((r) => visible(analysis.issuesById[r.issueId], filters));
  const hiddenProblems = chapter.rows.length - rows.length;
  const isAction = !!chapter.action;
  const quiet = chapter.rows.length === 0 && chapter.passedRequests === 0 && chapter.quietMessages === 0;
  return (
    <section className="chapter" aria-labelledby={`ch-${index}`}>
      <div className="chapter-time mono">{formatOffset(chapter.time - startedAt)}</div>
      <div className="chapter-rail" aria-hidden="true">
        <span
          className={`chapter-dot ${rows.some((r) => tone(analysis.issuesById[r.issueId]) === 'err') ? 'is-hot' : ''} ${isAction ? '' : 'is-ambient'}`}
        />
        {!isLast || recording ? <span className="chapter-line" /> : null}
      </div>
      <div className="chapter-body">
        <h3 className="chapter-title" id={`ch-${index}`}>
          {chapter.title}
          {chapter.action?.target ? (
            <span className="chapter-target mono">{chapter.action.target.selector}</span>
          ) : null}
        </h3>
        {rows.map((row) => {
          const issue = analysis.issuesById[row.issueId];
          const open = selectedId === issue.id;
          return (
            <div
              key={issue.id}
              className={`row tone-${tone(issue)} ${row.indent ? 'is-effect' : ''} ${open ? 'is-open' : ''}`}
              id={`issue-${cssId(issue.id)}`}
            >
              <button
                type="button"
                className="row-head"
                aria-expanded={open}
                onClick={() => onSelect(open ? null : issue.id)}
              >
                {row.indent ? (
                  <span className="row-arrow mono" aria-hidden="true">
                    └→
                  </span>
                ) : null}
                <span className="badge mono">{issue.tag}</span>
                <span className="row-title mono">{issue.title}</span>
                <span className="row-meta">
                  {row.countInChapter > 1 ? <span className="mono">×{row.countInChapter}</span> : null}
                  {issue.noise ? (
                    <span>noise</span>
                  ) : (
                    <span className="score mono" title={`Impact score ${issue.score}`}>
                      {issue.score}
                    </span>
                  )}
                  <span className="visually-hidden">{KIND_LABEL[issue.kind]}</span>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                </span>
              </button>
              {open ? (
                <IssueDetail
                  issue={issue}
                  analysis={analysis}
                  startedAt={startedAt}
                  onSelect={onSelect}
                  onMute={onMute}
                />
              ) : null}
            </div>
          );
        })}
        {chapter.passedRequests > 0 || hiddenProblems > 0 ? (
          <div className="row-quiet">
            {chapter.passedRequests > 0
              ? `${chapter.passedRequests} passed request${chapter.passedRequests === 1 ? '' : 's'}`
              : null}
            {chapter.passedRequests > 0 && hiddenProblems > 0 ? ' · ' : null}
            {hiddenProblems > 0 ? `${hiddenProblems} filtered out` : null}
          </div>
        ) : null}
        {quiet ? <div className="row-quiet">No network or console activity</div> : null}
      </div>
    </section>
  );
}

/** Issue ids contain `|` and URLs; make them safe for an element id. */
export function cssId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function StoryView(props: Props) {
  const { analysis, recording } = props;
  return (
    <div className="story">
      {analysis.chapters.map((chapter, i) => (
        <ChapterBlock
          key={chapter.id + i}
          chapter={chapter}
          index={i}
          isLast={i === analysis.chapters.length - 1}
          props={props}
        />
      ))}
      {recording ? (
        <section className="chapter is-waiting" aria-live="polite">
          <div className="chapter-time" />
          <div className="chapter-rail" aria-hidden="true">
            <span className="chapter-dot is-recording" />
          </div>
          <div className="chapter-body">
            <h3 className="chapter-title muted">
              {analysis.chapters.length
                ? 'Waiting for your next action…'
                : 'Recording. Reproduce the problem in the page.'}
            </h3>
          </div>
        </section>
      ) : null}
    </div>
  );
}
