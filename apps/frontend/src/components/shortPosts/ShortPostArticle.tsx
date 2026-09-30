import { useId, type MouseEvent, type MouseEventHandler } from 'react';
import { linkProps } from '../../navigation/links';
import { SharePopover } from '../billDetail/SharePopover';
import { ChevronLeft } from '../icons';
import {
  isoDateCapsLabel,
  isoDateCommaCapsLabel,
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
import {
  CONTRIBUTION_NOTE,
  shortPostRecordsLine,
  type ShortPostDisplayBlock,
} from '../../lib/shortPosts';
import { articleClosingNote, articleDisclosureRuns } from '../../lib/articleDisclosure';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { ShortPostChart } from './ShortPostChart';

type Props = {
  piece: ResearchPiece;
  privatePreview?: boolean;
  onCorrectionContact?: () => void;
  returnLink?: { href: string; label: string };
  onReturn?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

const FULL_MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/** Format coverage for the heading; source-copy dates remain in the sources. */
function articleRecordsLine(piece: ResearchPiece): string {
  if (piece.shortPost?.coveragePlacement === 'metadata') {
    return shortPostRecordsLine(piece)
      .toUpperCase()
      .replaceAll(':', '')
      .replace(/\b[A-Z]+(?= \d{1,2}, \d{4})/g, (month) =>
        FULL_MONTHS.includes(month) ? month.slice(0, 3) : month,
      );
  }
  if (piece.shortPost?.recordsScope === 'cited-filings') {
    return `RECORDS IN CITED FILINGS THROUGH ${isoDateCommaCapsLabel(piece.recordsThrough)}`;
  }
  return `RECORDS THROUGH ${isoDateCommaCapsLabel(piece.recordsThrough)}`;
}

function Runs({
  runs,
  onInternalLink,
}: {
  runs: readonly ResearchInline[];
  onInternalLink?: () => void;
}) {
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
            <a
              key={index}
              href={run.href}
              onClick={
                onInternalLink
                  ? (linkProps(run.href, onInternalLink)
                      .onPress as unknown as MouseEventHandler<HTMLAnchorElement>)
                  : undefined
              }
            >
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

function ProseBlock({ block, finalTotal = false }: { block: ResearchBlock; finalTotal?: boolean }) {
  if (block.kind === 'paragraph')
    return block.role === 'conclusion' ? (
      <div className="sp-prose-conclusion">
        <svg width="31" height="30" viewBox="0 0 84 82" role="img" aria-label="Alethical">
          <path d="M0 82 L38 0 L38 82 Z M84 82 L46 0 L46 82 Z" fill="#0f7a45" />
        </svg>
        <p className="sp-paragraph">
          <Runs runs={block.runs} />
        </p>
      </div>
    ) : (
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
            <tr
              key={index}
              className={
                (block.totalRow || finalTotal) && index === block.rows.length - 1
                  ? 'sp-prose-total'
                  : undefined
              }
            >
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

/** Explicit display choices for published tables; article inputs and review fingerprints stay intact. */
const FINAL_TOTAL_TABLES: Record<string, readonly number[]> = {
  'short-lobbyist-giving-2015-2026': [0],
  'short-organizations-both-parties-2015-2025': [0],
};

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
        const tableNumber = blocks.slice(0, index).filter((item) => item.kind === 'table').length;
        const finalTotal =
          block.kind === 'table' &&
          FINAL_TOTAL_TABLES[piece.articleId ?? '']?.includes(tableNumber);
        return <ProseBlock block={block} finalTotal={finalTotal} key={index} />;
      })}
    </div>
  );
}

/** Layout for an approved Short post. The publication gate decides whether it may be registered. */
export function ShortPostArticle({
  piece,
  privatePreview = false,
  onCorrectionContact,
  returnLink,
  onReturn,
}: Props) {
  const topicLabelId = useId();
  const editorial = piece.shortPost;
  if (!editorial || piece.format !== 'short-post') return null;
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
      <a className="sp-back" href={returnLink?.href ?? '/blog'} onClick={onReturn}>
        <ChevronLeft size={18} strokeWidth={2.2} aria-hidden />
        <span>{returnLink?.label ?? 'Back to Blog'}</span>
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
        {piece.dek ? <p className="sp-dek">{piece.dek}</p> : null}
        <div className="sp-meta-share">
          <p className="sp-meta">
            {privatePreview ? (
              <span>{articleRecordsLine(piece)}</span>
            ) : piece.traits.research ? (
              <>
                <span>PUBLISHED {isoDateCommaCapsLabel(piece.publishedOn)}</span>
                <span aria-hidden="true"> · </span>
                <span>{articleRecordsLine(piece)}</span>
              </>
            ) : (
              <>
                <span>{pieceReadingMinutes(piece)} MIN</span>
                <span aria-hidden="true"> · </span>
                <span>{pieceWrittenLine(piece)}</span>
              </>
            )}
          </p>
          <SharePopover content={shareContent} disabled={privatePreview} />
        </div>
        <nav className="sp-topics" aria-labelledby={topicLabelId}>
          <span id={topicLabelId}>{piece.topics?.length === 1 ? 'Topic' : 'Topics'}</span>
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
        {editorial.coverageNote && editorial.coveragePlacement !== 'metadata' ? (
          <p className="sp-coverage">{editorial.coverageNote}</p>
        ) : null}
        {editorial.limitationsPlacement !== 'body' ? (
          <p className="sp-coverage">{editorial.limitations}</p>
        ) : null}
      </section>

      <aside className="sp-disclosures">
        {(editorial.disclosures.length
          ? editorial.disclosures
          : [articleClosingNote(editorial.aiAssisted)]
        )
          .filter((note) => note !== CONTRIBUTION_NOTE)
          .map((note, index) => (
            <p key={index}>
              <Runs
                runs={articleDisclosureRuns(note, piece.articleId ?? piece.slug)}
                onInternalLink={onCorrectionContact}
              />
            </p>
          ))}
      </aside>
    </article>
  );
}

/** The editor's published picks close the article after reader comments. */
export function ShortPostRelatedReading({ piece }: { piece: ResearchPiece }) {
  const set = piece.set;
  const nextGuideSlug =
    set &&
    publishedResearch().find(
      (entry) => entry.set?.name === set.name && entry.set?.position === set.position + 1,
    )?.slug;
  const related = (piece.relatedSlugs ?? piece.shortPost?.relatedSlugs ?? [])
    .map((slug) => publishedResearch().find((entry) => entry.slug === slug))
    .filter((entry): entry is ResearchPiece =>
      Boolean(
        entry &&
        entry.slug !== piece.slug &&
        entry.slug !== nextGuideSlug &&
        entry.topics?.some((topic) => piece.topics?.includes(topic)),
      ),
    )
    .filter(
      (entry, index, entries) => entries.findIndex((other) => other.slug === entry.slug) === index,
    )
    .slice(0, 3);
  if (!related.length) return null;
  return (
    <div className="sp-related-wrap">
      {piece.format !== 'short-post' && <style>{articleCss}</style>}
      <section className="sp-related" aria-label="Related reading">
        <h2>Related reading</h2>
        <ul>
          {related.map((entry) => (
            <li key={entry.slug}>
              <a className="sp-related-row" href={piecePath(entry)}>
                <span className="sp-related-row-head">
                  <span className="sp-related-kind">{pieceKindLabel(entry)}</span>
                  <span className="sp-related-meta">{pieceCardMetaLine(entry)}</span>
                </span>
                <strong>{entry.title}</strong>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const articleCss = `
.sp-article{box-sizing:border-box;width:100%;max-width:700px;margin:0 auto;padding:38px 0 76px;background:#fff;color:#11150f;font-family:'Libre Franklin',Helvetica,Arial,sans-serif}.sp-article *{box-sizing:border-box}.sp-article a{color:#0f7a45;text-decoration:underline;overflow-wrap:anywhere}.sp-article a:hover{color:#11832b}.sp-article a:focus-visible,.sp-article summary:focus-visible{outline:2px solid #7c5cff;outline-offset:2px;border-radius:3px}
.sp-back{display:inline-flex;align-items:center;min-height:44px;gap:9px;color:#4b524b!important;font-size:16px;font-weight:600;text-decoration:none!important}.sp-back:hover{color:#11150f!important}.sp-back:hover span{text-decoration:underline}
.sp-newer,.sp-correction{margin:20px 0;padding:16px 18px;border-radius:13px;font-size:16px;line-height:1.55}.sp-newer{background:#fbf1e2;border:1px solid #f0d6a8}.sp-correction{background:#f7f8fa;border:1px solid rgba(17,21,15,.14)}.sp-newer strong,.sp-correction strong{display:block;font-size:12px;font-weight:800;letter-spacing:.02em}.sp-correction strong{color:#8a2a17}.sp-newer-link{display:inline-flex;align-items:center;min-height:44px;font-weight:700}.sp-newer p,.sp-correction p{margin:6px 0 0}
.sp-header{margin-top:30px}.sp-kind{display:inline-block;font-family:'JetBrains Mono',monospace;color:#2b6377;font-size:11px;font-weight:700;letter-spacing:.14em;line-height:1.5;text-transform:uppercase}.sp-related-kind{display:inline-block;background:#eef0ee;border:0;border-radius:6px;padding:5px 8px;color:#11150f;font-size:13px;font-weight:700;line-height:1}.sp-header h1{font-size:48px;line-height:1.08;font-weight:800;letter-spacing:-.03em;margin:16px 0 0;overflow-wrap:anywhere}.sp-dek{font-size:22px;line-height:1.5;color:#2c322c;margin:18px 0 24px}.sp-header h1+.sp-meta-share{margin-top:24px}.sp-meta-share{border-top:1px solid rgba(17,21,15,.1);padding-top:18px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px}.sp-meta{margin:0;color:#656c66;font-size:11.5px;line-height:1.5;font-weight:800;letter-spacing:.01em;font-variant-numeric:tabular-nums}.sp-topics{display:flex;align-items:center;flex-wrap:wrap;gap:0 8px;margin-top:12px}.sp-topics>span{font-size:14.5px;font-weight:700;color:#4f5651;margin-right:4px}.sp-topics ul{flex:1 1 240px;list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0 8px;min-width:0}.sp-topics li{margin:0;min-width:0}.sp-topics a{display:inline-flex;align-items:center;min-height:44px;max-width:100%;color:#11150f;text-decoration:none}.sp-topics a>span{display:inline-block;max-width:100%;padding:6px 12px;border:1px solid rgba(17,21,15,.18);border-radius:8px;font-size:14.5px;line-height:1.35;font-weight:600;background:#fff}.sp-topics a:active>span{background:#e6e9e7}
@media(hover:hover){.sp-topics a:hover{color:#11150f}.sp-topics a:hover>span{background:#f1f3f2;border-color:rgba(17,21,15,.3)}}
.sp-prose-conclusion{display:flex;align-items:flex-start;gap:14px;--conclusion-line-height:32px}.sp-prose-conclusion>svg{flex:none;margin-top:calc((2 * var(--conclusion-line-height) - 30px) / 2)}.sp-prose-conclusion>p{min-width:0}.sp-body{margin-top:30px}.sp-paragraph,.sp-bullets{font-size:19px;line-height:32px;color:#1a201d;margin:0 0 26px}.sp-bullets{padding-left:26px}.sp-bullets li{padding-left:4px;margin:0 0 8px}.sp-body h2{font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-.02em;margin:38px 0 15px}.sp-limitation,.sp-method,.sp-amendment{border-radius:12px;padding:14px 16px;margin:18px 0 28px;color:#2c322c;font-size:16.5px;line-height:1.55}.sp-limitation,.sp-method{background:#f7f8fa;border:1px solid rgba(17,21,15,.1)}.sp-amendment{background:#fff;border:1px solid rgba(17,21,15,.24)}.sp-limitation>span{font-size:10.5px;font-weight:800;letter-spacing:.07em}.sp-method>strong,.sp-amendment>strong{font-size:12px;font-weight:800}.sp-limitation p,.sp-method p,.sp-amendment p{margin:5px 0 0}.sp-method{border-color:rgba(17,21,15,.08);border-radius:15px;padding:22px 24px 10px}.sp-method>strong,.sp-limitation>span{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.12em;color:#4f5651}.sp-method>p{margin-top:10px;font-size:17px;line-height:1.6}.sp-method details{margin-top:6px}.sp-method summary{cursor:pointer;display:flex;align-items:center;gap:8px;min-height:44px;color:#11150f;font-size:16px;font-weight:700;list-style:none}.sp-method summary::-webkit-details-marker{display:none}.sp-method summary svg{flex:none}.sp-method details[open] summary svg{transform:rotate(90deg)}.sp-method details>p{padding:4px 0 14px 22px;font-size:16px;line-height:1.6}@media(hover:hover){.sp-method summary:hover{text-decoration:underline}}.sp-prose-table-scroll{overflow-x:auto;margin-bottom:26px}.sp-prose-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}.sp-prose-table th,.sp-prose-table td{padding:10px 12px;border-bottom:1px solid #d3d7d3;text-align:left}.sp-prose-table .sp-prose-total th,.sp-prose-table .sp-prose-total td{border-bottom:0}.sp-prose-table td:not(:first-child){white-space:nowrap}
.sp-sources{margin-top:40px;border-top:1px solid rgba(17,21,15,.18);padding-top:28px}.sp-sources h2{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.12em;font-weight:700;color:#4f5651;margin:0 0 14px}.sp-sources p{font-size:17px;line-height:1.6;margin:0 0 12px;overflow-wrap:anywhere}.sp-sources .sp-coverage{color:#4b524b}.sp-disclosures{margin-top:22px;padding:16px 18px;border:1px solid rgba(17,21,15,.1);border-radius:13px;background:#f7f8fa;font-size:16px;line-height:1.6;color:#11150f}.sp-disclosures p{margin:0}.sp-disclosures p+p{margin-top:12px}
.sp-related-wrap{box-sizing:border-box;width:100%;border-top:1px solid rgba(17,21,15,.14);padding:48px 56px 72px;background:#fff}.sp-related{max-width:700px;margin:0 auto;color:#11150f;font-family:'Libre Franklin',Helvetica,Arial,sans-serif}.sp-related *{box-sizing:border-box}.sp-related h2{font-size:22px;font-weight:800;letter-spacing:-.012em;margin:0}.sp-related ul{list-style:none;margin:12px 0 0;padding:0;border-top:1px solid rgba(17,21,15,.1)}.sp-related li{margin:0;border-bottom:1px solid rgba(17,21,15,.1)}.sp-related-row{display:block;padding:16px 12px;margin:0 -12px;border-radius:10px;text-decoration:none;color:#11150f}.sp-related-row-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}.sp-related-row>strong{display:block;margin-top:8px;font-size:19px;line-height:1.3;font-weight:700;color:#11150f;text-wrap:pretty}.sp-related-meta{font-size:11.5px;font-weight:800;letter-spacing:.01em;color:#656c66;font-variant-numeric:tabular-nums}@media(hover:hover){.sp-related-row:hover{background:#f5f6f7}.sp-related-row:hover>strong{color:#0f7a45}}.sp-related-row:active{background:#eef0ee}.sp-related-row:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
@media(min-width:768px) and (max-width:1099px){.sp-header h1{font-size:42px}.sp-related-wrap{padding-left:40px;padding-right:40px}}@media(max-width:767px){.sp-article{padding-top:22px;padding-bottom:50px}.sp-header h1{font-size:32px}.sp-header{margin-top:20px}.sp-header h1{margin-top:12px}.sp-dek{font-size:19px;margin:12px 0 18px}.sp-meta-share{padding-top:14px}.sp-topics{margin-top:10px}.sp-body{margin-top:22px}.sp-method{padding:18px 18px 8px}.sp-related-wrap{padding:34px 20px 48px}.sp-related h2{font-size:20px}.sp-related-row>strong{font-size:18px}.sp-meta-share{align-items:flex-start}.sp-meta{display:flex;flex-wrap:wrap;gap:0 4px}.sp-prose-conclusion{--conclusion-line-height:30px}.sp-paragraph,.sp-bullets{font-size:18px;line-height:30px}.sp-body h2{font-size:22px}.sp-sources{margin-top:30px;padding-top:22px}}
`;
