import type { MouseEvent } from 'react';
import {
  pieceCardMetaLine,
  pieceKindLabel,
  piecePath,
  type ResearchPiece,
} from '../../lib/research';
import { TOPICS, topicPath, type TopicSlug } from '../../lib/researchIndex';

/** Keep the title and topic anchors siblings so each has its own keyboard stop. */
export function TopicPieceCard({
  piece,
  showKind = true,
  headingLevel = 3,
  variant = 'card',
  currentTopic,
  onOpen,
  onTopic,
}: {
  piece: ResearchPiece;
  showKind?: boolean;
  headingLevel?: 2 | 3;
  variant?: 'card' | 'row';
  currentTopic?: TopicSlug;
  onOpen?: () => void;
  onTopic?: (topic: TopicSlug) => void;
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>, action?: () => void) => {
    if (
      !action ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    action();
  };
  const topics = piece.topics?.filter((topic) => topic !== currentTopic) ?? [];
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={`topic-piece${variant === 'row' ? ' topic-piece-row' : ''}`}
      data-entry={piece.slug}
    >
      <style>{topicPieceCss}</style>
      <div className="topic-piece-meta">
        {showKind && <span className="topic-piece-kind">{pieceKindLabel(piece)}</span>}
        <span>{pieceCardMetaLine(piece)}</span>
      </div>
      <Heading className="topic-piece-title">
        <a
          data-entry-link={piece.slug}
          href={piecePath(piece)}
          onClick={(event) => follow(event, onOpen)}
        >
          {piece.title}
        </a>
      </Heading>
      <p className="topic-piece-dek">{piece.dek}</p>
      {topics.length > 0 && (
        <ul className="topic-piece-topics" aria-label={currentTopic ? 'Other topics' : 'Topics'}>
          {topics.map((slug) => (
            <li key={slug}>
              <a
                href={topicPath(slug)}
                onClick={(event) => follow(event, onTopic ? () => onTopic(slug) : undefined)}
              >
                <span>{TOPICS.find((topic) => topic.slug === slug)?.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const topicPieceCss = `
.topic-piece{position:relative;box-sizing:border-box;background:#fff;border:1px solid rgba(17,21,15,.1);border-radius:16px;box-shadow:0 6px 18px rgba(17,21,15,.05);padding:26px 30px 14px;font-family:'Libre Franklin',sans-serif;color:#11150f;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.topic-piece-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:11.5px;font-weight:800;letter-spacing:.01em;color:#656c66;font-variant-numeric:tabular-nums}.topic-piece-kind{font-size:13px;font-weight:700;color:#11150f;background:#eef0ee;border-radius:6px;padding:5px 8px}
.topic-piece .topic-piece-title{margin:12px 0 0;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-.018em;text-wrap:pretty}.topic-piece .topic-piece-title a{color:#11150f;text-decoration:none}.topic-piece .topic-piece-title a::after{content:'';position:absolute;inset:0;border-radius:16px}.topic-piece a:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.topic-piece .topic-piece-title a:focus-visible{outline:none}.topic-piece .topic-piece-title a:focus-visible::after{outline:2px solid #7c5cff;outline-offset:2px}
.topic-piece-dek{margin:8px 0 0;max-width:680px;font-size:17px;line-height:1.5;color:#4b524b;text-wrap:pretty}.topic-piece-topics{position:relative;z-index:1;list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:0 8px;width:fit-content;max-width:100%}.topic-piece-topics li{min-width:0}.topic-piece-topics a{display:inline-flex;align-items:center;min-height:44px;max-width:100%;color:#11150f;text-decoration:none}.topic-piece-topics span{padding:5px 11px;border:1px solid rgba(17,21,15,.18);border-radius:8px;font-size:14px;line-height:1.35;font-weight:600;background:#fff;overflow-wrap:anywhere}
@media(hover:hover){.topic-piece:hover{border-color:rgba(45,212,126,.85);box-shadow:0 22px 46px rgba(17,21,15,.14);transform:translateY(-3px)}.topic-piece-topics a:hover span{background:#f1f3f2;border-color:rgba(17,21,15,.3)}}.topic-piece-topics a:active span{background:#e6e9e7}
.topic-piece-row{background:transparent;border:0;border-radius:10px;box-shadow:none;padding:22px 14px 8px;margin:0 -14px;transition:background .14s ease}.topic-piece-row .topic-piece-title{margin-top:11px;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.012em}.topic-piece-row .topic-piece-title a::after{border-radius:10px}.topic-piece-row .topic-piece-dek{margin-top:7px}.topic-piece-row .topic-piece-topics{margin-top:4px}@media(hover:hover){.topic-piece-row:hover{background:#f5f6f7;box-shadow:none;transform:none}.topic-piece-row:hover .topic-piece-title a{color:#0f7a45}}
@media(prefers-reduced-motion:reduce){.topic-piece{transition:none}.topic-piece:hover{transform:none}}
@media(max-width:767px){.topic-piece{padding:18px}.topic-piece .topic-piece-title{margin-top:9px;font-size:20px}.topic-piece-meta{font-size:11px}.topic-piece-dek{font-size:16px}.topic-piece-topics{margin-top:6px}.topic-piece-row{padding:16px 10px 6px;margin:0 -10px}.topic-piece-row .topic-piece-title{font-size:19px}}
`;

/** The /read preview uses rows inside one shared box, distinct from archive cards. */
export function ShortPostsPreview({
  pieces,
  onOpen,
  onTopic,
  onAll,
}: {
  pieces: ResearchPiece[];
  onOpen: (piece: ResearchPiece) => void;
  onTopic: (topic: TopicSlug) => void;
  onAll: () => void;
}) {
  return (
    <div className="short-posts-preview">
      <style>{`.short-posts-preview{margin-top:18px;background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px;padding:12px 36px 28px}.short-posts-preview>ol{list-style:none;margin:0;padding:0}.short-posts-preview>ol>li+li{border-top:1px solid rgba(17,21,15,.07)}.short-posts-preview-all{border-top:1px solid rgba(17,21,15,.08);padding-top:20px}.short-posts-preview-all a{display:inline-flex;align-items:center;gap:9px;min-height:44px;font-family:'Libre Franklin',sans-serif;font-size:17px;font-weight:600;color:#0f7a45;text-decoration:none}.short-posts-preview-all a:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}@media(hover:hover){.short-posts-preview-all a:hover{color:#11832b;text-decoration:underline}}@media(max-width:767px){.short-posts-preview{margin-top:14px;padding:8px 20px 20px}.short-posts-preview-all{padding-top:16px}}`}</style>
      <ol aria-label="Short posts">
        {pieces.map((piece) => (
          <li key={piece.articleId ?? piece.slug}>
            <TopicPieceCard
              piece={piece}
              variant="row"
              onOpen={() => onOpen(piece)}
              onTopic={onTopic}
            />
          </li>
        ))}
      </ol>
      <div className="short-posts-preview-all">
        <a
          href="/read/short-posts"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onAll();
          }}
        >
          All short posts{' '}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12 H19 M14 7 L19 12 L14 17"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
