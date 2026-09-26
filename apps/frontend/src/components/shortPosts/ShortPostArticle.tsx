import { useId } from 'react';
import { SharePopover } from '../billDetail/SharePopover';
import {
  isoDateCapsLabel,
  isoDateLabel,
  pieceCardMetaLine,
  pieceKindLabel,
  piecePath,
  pieceReadingMinutes,
  pieceShareDescription,
  pieceSharePanelDescription,
  pieceSourcesLabel,
  pieceWrittenLine,
  publishedResearch,
  type ResearchBlock,
  type ResearchInline,
  type ResearchPiece,
} from '../../lib/research';
import { TOPICS, topicPath } from '../../lib/researchIndex';
import type { ShortPostDisplayBlock } from '../../lib/shortPosts';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { ShortPostChart } from './ShortPostChart';

type Props = { piece: ResearchPiece };

function Runs({ runs }: { runs: readonly ResearchInline[] }) {
  return (
    <>
      {runs.map((run, index) => {
        if (run.kind === 'externalLink')
          return (
            <a key={index} href={run.href} target="_blank" rel="noopener noreferrer">
              {run.text}
            </a>
          );
        if (run.kind === 'internalLink')
          return (
            <a key={index} href={run.href}>
              {run.text}
            </a>
          );
        if (run.kind === 'bold') return <strong key={index}>{run.text}</strong>;
        if (run.kind === 'italic') return <em key={index}>{run.text}</em>;
        return <span key={index}>{run.text}</span>;
      })}
    </>
  );
}

function ProseBlock({ block }: { block: ResearchBlock }) {
  if (block.kind === 'paragraph')
    return (
      <p className="sp-paragraph">
        <Runs runs={block.runs} />
      </p>
    );
  if (block.kind === 'bullets')
    return (
      <ul className="sp-bullets">
        {block.items.map((runs, index) => (
          <li key={index}>
            <Runs runs={runs} />
          </li>
        ))}
      </ul>
    );
  if (block.kind === 'note')
    return (
      <aside className="sp-limitation">
        <span>SHOWING OUR WORK</span>
        <p>{block.text}</p>
      </aside>
    );
  return (
    <div className="sp-prose-table-scroll">
      <table className="sp-prose-table">
        <thead>
          <tr>
            {block.columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, cell) =>
                cell === 0 ? (
                  <th scope="row" key={cell}>
                    {value}
                  </th>
                ) : (
                  <td key={cell}>{value}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fallbackBody(piece: ResearchPiece): ShortPostDisplayBlock[] {
  return [
    ...piece.shortVersion,
    ...(piece.intro ?? []),
    ...piece.sections.flatMap((section) => [
      { kind: 'heading' as const, text: section.heading },
      ...section.blocks,
      ...(section.methodologyInset
        ? [{ kind: 'method' as const, essential: section.methodologyInset.body }]
        : []),
    ]),
  ];
}

function ArticleBody({ piece }: Props) {
  const editorial = piece.shortPost;
  if (!editorial) return null;
  const blocks = editorial.body ?? fallbackBody(piece);
  return (
    <div className="sp-body">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') return <h2 key={index}>{block.text}</h2>;
        if (block.kind === 'chart') {
          const graphic = editorial.graphics.find((item) => item.id === block.graphicId);
          const display = editorial.charts?.find((item) => item.graphicId === block.graphicId);
          const evidence = editorial.evidence.find((item) => item.id === display?.sourceEvidenceId);
          if (!graphic || !display || !evidence)
            throw new Error(
              `Short post chart ${block.graphicId} needs checked data, title, source and limitation`,
            );
          const correction =
            display.correctionHistoryIndex === undefined
              ? undefined
              : editorial.history[display.correctionHistoryIndex];
          return (
            <ShortPostChart
              key={`${block.graphicId}-${index}`}
              graphic={graphic}
              display={display}
              evidence={evidence}
              correction={correction}
              articleId={piece.articleId ?? piece.slug}
            />
          );
        }
        if (block.kind === 'limitation')
          return (
            <aside className="sp-limitation" key={index}>
              <span>{block.label}</span>
              <p>{block.text}</p>
            </aside>
          );
        if (block.kind === 'source-amendment') {
          const history = editorial.history[block.historyIndex];
          if (!history || history.kind !== 'source-amendment')
            throw new Error('Source amendment needs its dated article history');
          return (
            <aside
              className="sp-amendment"
              id={`source-amendment-${block.historyIndex}`}
              key={index}
            >
              <strong>SOURCE AMENDED {isoDateCapsLabel(history.datedOn)}</strong>
              <p>{history.explanation}</p>
            </aside>
          );
        }
        if (block.kind === 'method')
          return (
            <aside className="sp-method" key={index}>
              <strong>HOW THIS WAS CALCULATED</strong>
              <p>{block.essential}</p>
              {block.full ? (
                <details>
                  <summary>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M9 5 L16 12 L9 19"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Full method
                  </summary>
                  <p>{block.full}</p>
                </details>
              ) : null}
            </aside>
          );
        return <ProseBlock block={block} key={index} />;
      })}
    </div>
  );
}

/** Layout for an approved Short post. The publication gate decides whether it may be registered. */
export function ShortPostArticle({ piece }: Props) {
  const topicLabelId = useId();
  const editorial = piece.shortPost;
  if (!editorial || piece.format !== 'short-post') return null;
  const related = (editorial.relatedSlugs ?? [])
    .map((slug) => publishedResearch().find((entry) => entry.slug === slug))
    .filter((entry): entry is ResearchPiece =>
      Boolean(
        entry &&
        entry.slug !== piece.slug &&
        entry.topics?.some((topic) => piece.topics?.includes(topic)),
      ),
    )
    .slice(0, 3);
  const shareContent: ShareContent = {
    subject: piece.traits.research ? 'research' : 'guide',
    title: piece.title,
    description: pieceShareDescription(piece),
    previewDescription: pieceSharePanelDescription(piece),
    url: publicPageUrl(piecePath(piece)),
  };
  const notices = editorial.history.map((event, index) => ({
    ...event,
    index,
    newer: publishedResearch().find((entry) => entry.slug === event.newerCoverageSlug),
  }));

  return (
    <article className="sp-article">
      <style>{articleCss}</style>
      <a className="sp-back" href={`/read/short-posts?post=${encodeURIComponent(piece.slug)}`}>
        <span aria-hidden="true">‹</span> All short posts
      </a>
      {notices
        .filter((event) => event.kind === 'newer-records')
        .map((event) => (
          <aside className="sp-newer" key={event.index}>
            <strong>NEWER FILINGS EXIST</strong>
            <time dateTime={event.datedOn}>{isoDateLabel(event.datedOn)}</time>
            <p>{event.explanation}</p>
            {event.newer && (
              <a className="sp-newer-link" href={piecePath(event.newer)}>
                {event.newer.title}
              </a>
            )}
          </aside>
        ))}
      {notices
        .filter((event) => event.kind === 'our-correction')
        .map((event, correctionIndex) => (
          <aside className="sp-correction" id={`correction-${event.index}`} key={event.index}>
            <strong id={correctionIndex === 0 ? 'correction' : undefined}>
              CORRECTED {isoDateCapsLabel(event.datedOn)}
            </strong>
            <p>{event.explanation}</p>
          </aside>
        ))}

      <header className="sp-header">
        <span className="sp-kind">{pieceKindLabel(piece)}</span>
        <h1>{piece.title}</h1>
        <p className="sp-dek">{piece.dek}</p>
        <div className="sp-meta-share">
          <p className="sp-meta">
            {piece.traits.research ? (
              <>
                <span>PUBLISHED {isoDateCapsLabel(piece.publishedOn)}</span>
                <span aria-hidden="true"> · </span>
                <span>RECORDS THROUGH {isoDateCapsLabel(piece.recordsThrough)}</span>
              </>
            ) : (
              <>
                <span>{pieceReadingMinutes(piece)} MIN</span>
                <span aria-hidden="true"> · </span>
                <span>{pieceWrittenLine(piece)}</span>
              </>
            )}
          </p>
          <SharePopover content={shareContent} />
        </div>
        <nav className="sp-topics" aria-labelledby={topicLabelId}>
          <span id={topicLabelId}>Topics</span>
          <ul aria-labelledby={topicLabelId}>
            {(piece.topics ?? []).map((slug) => {
              const topic = TOPICS.find((entry) => entry.slug === slug);
              return topic ? (
                <li key={slug}>
                  <a href={topicPath(slug)}>
                    <span>{topic.label}</span>
                  </a>
                </li>
              ) : null;
            })}
          </ul>
        </nav>
      </header>

      <ArticleBody piece={piece} />

      <section className="sp-sources" aria-label={pieceSourcesLabel(piece)}>
        <h2>{pieceSourcesLabel(piece)}</h2>
        {piece.sources.map((source, index) => (
          <p key={index}>
            {source.text} {source.note}{' '}
            {source.noteLink ? (
              <a href={source.noteLink.href} target="_blank" rel="noopener noreferrer">
                {source.noteLink.text}
              </a>
            ) : null}
          </p>
        ))}
        {(piece.sourceRuns ?? []).map((runs, index) => (
          <p key={`runs-${index}`}>
            <Runs runs={runs} />
          </p>
        ))}
        <p className="sp-coverage">{editorial.coverageNote}</p>
        <p className="sp-coverage">{editorial.limitations}</p>
      </section>

      <aside className="sp-disclosures">
        {editorial.disclosures.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </aside>

      {related.length ? (
        <section className="sp-related" aria-label="Related reading">
          <h2>Related reading</h2>
          {related.map((entry) => (
            <a className="sp-related-row" href={piecePath(entry)} key={entry.slug}>
              <span className="sp-related-kind">{pieceKindLabel(entry)}</span>
              <span className="sp-related-meta">{pieceCardMetaLine(entry)}</span>
              <strong>{entry.title}</strong>
            </a>
          ))}
        </section>
      ) : null}
    </article>
  );
}

const articleCss = `
.sp-article{box-sizing:border-box;width:100%;max-width:700px;margin:0 auto;padding:38px 0 76px;background:#fff;color:#11150f;font-family:'Libre Franklin',Helvetica,Arial,sans-serif}.sp-article *{box-sizing:border-box}.sp-article a{color:#0f7a45;text-decoration:underline;overflow-wrap:anywhere}.sp-article a:hover{color:#11832b}.sp-article a:focus-visible,.sp-article summary:focus-visible{outline:2px solid #7c5cff;outline-offset:2px;border-radius:3px}
.sp-back{display:inline-flex;align-items:center;min-height:44px;gap:9px;color:#4b524b!important;font-size:16px;font-weight:600;text-decoration:none!important}.sp-back:hover{color:#11150f!important;text-decoration:underline!important}.sp-back span{font-size:25px;line-height:1}
.sp-newer,.sp-correction{margin:20px 0;padding:16px 18px;border-radius:13px;font-size:16px;line-height:1.55}.sp-newer{background:#fbf1e2;border:1px solid #f0d6a8}.sp-correction{background:#f7f8fa;border:1px solid rgba(17,21,15,.14)}.sp-newer strong,.sp-correction strong{display:block;font-size:12px;font-weight:800;letter-spacing:.02em}.sp-correction strong{color:#8a2a17}.sp-newer-link{display:inline-flex;align-items:center;min-height:44px;font-weight:700}.sp-newer p,.sp-correction p{margin:6px 0 0}
.sp-header{margin-top:30px}.sp-kind,.sp-related-kind{display:inline-block;background:#eef0ee;border:0;border-radius:6px;padding:5px 8px;color:#11150f;font-size:13px;font-weight:700;line-height:1}.sp-header h1{font-size:48px;line-height:1.08;font-weight:800;letter-spacing:-.03em;margin:16px 0 0;overflow-wrap:anywhere}.sp-dek{font-size:22px;line-height:1.5;color:#2c322c;margin:18px 0 24px}.sp-meta-share{border-top:1px solid rgba(17,21,15,.1);padding-top:18px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px}.sp-meta{margin:0;color:#4f5651;font-size:11.5px;line-height:1.5;font-weight:800;letter-spacing:.02em;font-variant-numeric:tabular-nums}.sp-meta span:not([aria-hidden]){white-space:nowrap}.sp-topics{display:flex;align-items:center;flex-wrap:wrap;gap:0 8px;margin-top:12px}.sp-topics>span{font-size:14.5px;font-weight:700;color:#4f5651;margin-right:4px}.sp-topics ul{flex:1 1 240px;list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0 8px;min-width:0}.sp-topics li{margin:0;min-width:0}.sp-topics a{display:inline-flex;align-items:center;min-height:44px;max-width:100%;color:#11150f;text-decoration:none}.sp-topics a>span{display:inline-block;max-width:100%;padding:6px 12px;border:1px solid rgba(17,21,15,.18);border-radius:8px;font-size:14.5px;line-height:1.35;font-weight:600;background:#fff}.sp-topics a:active>span{background:#e6e9e7}
@media(hover:hover){.sp-topics a:hover{color:#11150f}.sp-topics a:hover>span{background:#f1f3f2;border-color:rgba(17,21,15,.3)}}
.sp-body{margin-top:30px}.sp-paragraph,.sp-bullets{font-size:19px;line-height:32px;color:#1a201d;margin:0 0 26px}.sp-bullets{padding-left:26px}.sp-bullets li{padding-left:4px;margin:0 0 8px}.sp-body h2{font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-.02em;margin:38px 0 15px}.sp-limitation,.sp-method,.sp-amendment{border-radius:12px;padding:14px 16px;margin:18px 0 28px;color:#2c322c;font-size:16.5px;line-height:1.55}.sp-limitation,.sp-method{background:#f7f8fa;border:1px solid rgba(17,21,15,.1)}.sp-amendment{background:#fff;border:1px solid rgba(17,21,15,.24)}.sp-limitation>span{font-size:10.5px;font-weight:800;letter-spacing:.07em}.sp-method>strong,.sp-amendment>strong{font-size:12px;font-weight:800}.sp-limitation p,.sp-method p,.sp-amendment p{margin:5px 0 0}.sp-method{border-color:rgba(17,21,15,.08);border-radius:15px;padding:22px 24px 10px}.sp-method>strong,.sp-limitation>span{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.12em;color:#4f5651}.sp-method>p{margin-top:10px;font-size:17px;line-height:1.6}.sp-method details{margin-top:6px}.sp-method summary{cursor:pointer;display:flex;align-items:center;gap:8px;min-height:44px;color:#11150f;font-size:16px;font-weight:700;list-style:none}.sp-method summary::-webkit-details-marker{display:none}.sp-method summary svg{flex:none}.sp-method details[open] summary svg{transform:rotate(90deg)}.sp-method details>p{padding:4px 0 14px 22px;font-size:16px;line-height:1.6}@media(hover:hover){.sp-method summary:hover{text-decoration:underline}}.sp-prose-table-scroll{overflow-x:auto}.sp-prose-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}.sp-prose-table th,.sp-prose-table td{padding:10px 12px;border-bottom:1px solid #d3d7d3;text-align:left}.sp-prose-table td:not(:first-child){white-space:nowrap}
.sp-sources{margin-top:44px;border-top:1px solid rgba(17,21,15,.18);padding-top:23px}.sp-sources h2{font-size:11px;letter-spacing:.08em;font-weight:800;color:#4b524b;margin:0 0 16px}.sp-sources p{font-size:15.5px;line-height:1.65;margin:0 0 10px;overflow-wrap:anywhere}.sp-sources .sp-coverage{color:#4b524b}.sp-disclosures{margin-top:22px;padding:16px 18px;border:1px solid rgba(17,21,15,.1);border-radius:13px;background:#f7f8fa;font-size:16px;line-height:1.6;color:#11150f}.sp-disclosures p{margin:0}.sp-disclosures p+p{margin-top:12px;padding-top:12px;border-top:1px solid rgba(17,21,15,.1)}
.sp-related{margin-top:44px}.sp-related h2{font-size:20px;font-weight:800;margin:0 0 14px}.sp-related-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:16px 12px;margin:0 -12px;border-radius:10px;border-top:1px solid rgba(17,21,15,.12);text-decoration:none!important}@media(hover:hover){.sp-related-row:hover{background:#f5f6f7}.sp-related-row:hover>strong{color:#0f7a45}}.sp-related-row:active{background:#eef0ee}.sp-related-row>strong{display:block;flex-basis:100%;font-size:19px;line-height:1.3;font-weight:700;color:#11150f}.sp-related-meta{font-size:11px;font-weight:800;color:#4f5651;font-variant-numeric:tabular-nums}
@media(min-width:768px) and (max-width:1099px){.sp-header h1{font-size:42px}}@media(max-width:767px){.sp-article{padding-top:22px;padding-bottom:50px}.sp-header h1{font-size:32px}.sp-header{margin-top:20px}.sp-header h1{margin-top:12px}.sp-dek{font-size:19px;margin:12px 0 18px}.sp-meta-share{padding-top:14px}.sp-topics{margin-top:10px}.sp-body{margin-top:22px}.sp-method{padding:18px 18px 8px}.sp-related-row>strong{font-size:18px}.sp-meta-share{align-items:flex-start}.sp-meta{display:flex;flex-wrap:wrap;gap:0 4px}.sp-paragraph,.sp-bullets{font-size:18px;line-height:30px}.sp-body h2{font-size:22px}}
`;
