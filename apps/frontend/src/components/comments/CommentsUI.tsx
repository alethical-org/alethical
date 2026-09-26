import {
  Children,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { ReaderComment } from '../../data/comments';
import { commentDateLine } from './state';

export function CommentButton({
  label,
  busyLabel,
  busy = false,
  locked = false,
  kind = 'green',
  className = '',
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  locked?: boolean;
  kind?: 'green' | 'outline' | 'dark' | 'text';
}) {
  return (
    <button
      {...props}
      className={`rc-button rc-${kind} ${className}`}
      aria-disabled={busy || locked}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy || locked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="rc-button-labels">
        <span style={{ visibility: busy ? 'hidden' : 'visible' }}>{label}</span>
        {busyLabel && <span style={{ visibility: busy ? 'visible' : 'hidden' }}>{busyLabel}</span>}
      </span>
    </button>
  );
}

export function CommentNotice({
  children,
  id,
  focus = true,
}: {
  children: ReactNode;
  id?: string;
  focus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const message = Children.toArray(children)
    .filter((child) => typeof child === 'string' || typeof child === 'number')
    .join('');
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [message, focus]);
  return (
    <div id={id} ref={ref} tabIndex={-1} role="alert" className="rc-notice">
      <span aria-hidden="true" className="rc-error-mark">
        !
      </span>
      <div>{children}</div>
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return children ? (
    <p id={id} className="rc-field-error">
      <span aria-hidden="true" className="rc-error-mark">
        !
      </span>
      {children}
    </p>
  ) : null;
}

export function DiscussionRules() {
  const rules = [
    'No threats, harassment or slurs',
    'Do not share private information about anyone',
    'Do not impersonate anyone, including in your public name',
    'No spam or advertising',
    'Do not present as fact a claim that clearly contradicts the source you link. Accusations of wrongdoing against identifiable people need a linked source that directly supports them.',
  ];
  return (
    <aside className="rc-rules rc-card" aria-label="Discussion rules">
      <h3>Discussion rules</h3>
      <p>
        Questions, corrections, personal experiences and disagreement are welcome. Link to a source
        for factual claims.
      </p>
      <ol>
        {rules.map((rule, index) => (
          <li key={rule}>
            <span aria-hidden="true">{index + 1}.</span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function CommentDialog({
  comment,
  action,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  comment: ReaderComment;
  action: 'delete' | 'remove';
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const title = `${action === 'delete' ? 'Delete' : 'Remove'} ${comment.root_id ? 'reply' : 'comment'}?`;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    const siblings = [...document.body.children].filter(
      (child) => !child.contains(backdrop.current),
    );
    const previous = siblings.map((child) => ({ child, inert: (child as HTMLElement).inert }));
    previous.forEach(({ child }) => {
      (child as HTMLElement).inert = true;
    });
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const resize = () => {
      if (!backdrop.current) return;
      backdrop.current.style.height = `${viewport?.height ?? window.innerHeight}px`;
      backdrop.current.style.top = `${viewport?.offsetTop ?? 0}px`;
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const targets = [
        ...(box.current?.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, [tabindex="0"]',
        ) ?? []),
      ].filter((node) => !node.hasAttribute('disabled'));
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) {
        event.preventDefault();
        heading.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === heading.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === heading.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      previous.forEach(({ child, inert }) => {
        (child as HTMLElement).inert = inert;
      });
      document.body.style.overflow = oldOverflow;
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      document.removeEventListener('keydown', keydown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <div
      ref={backdrop}
      className="rc rc-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={id} className="rc-dialog">
        <div className="rc-dialog-head">
          <h2 id={id} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="rc-close"
            aria-label="Close"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="rc-dialog-body">
          <div className="rc-excerpt">
            <strong>
              {comment.name} · {commentDateLine(comment)}
            </strong>
            <p>{comment.body}</p>
          </div>
          {error && <CommentNotice>{error}</CommentNotice>}
        </div>
        <div className="rc-dialog-actions">
          <CommentButton
            label={action === 'delete' ? 'Delete' : 'Remove'}
            busyLabel={action === 'delete' ? 'Deleting…' : 'Removing…'}
            busy={busy}
            kind="dark"
            onClick={onConfirm}
          />
          <CommentButton label="Cancel" kind="outline" locked={busy} onClick={onClose} />
        </div>
        <span role="status" className="rc-sr-only">
          {busy ? (action === 'delete' ? 'Deleting…' : 'Removing…') : ''}
        </span>
      </div>
    </div>,
    document.body,
  );
}

export const COMMENTS_CSS = `
.rc {font-family:'Libre Franklin',sans-serif;color:#11150f;font-size:16px;line-height:1.5;box-sizing:border-box;min-width:0}
.rc *, .rc *::before, .rc *::after {box-sizing:border-box}
.rc h1,.rc h2,.rc h3,.rc p,.rc ol {margin:0}
.rc h2 {font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-.015em}
.rc h3 {font-size:18px;font-weight:800}
.rc button,.rc input,.rc textarea {font:inherit}
.rc button,.rc a,.rc label {touch-action:manipulation}
.rc button:focus,.rc a:focus,.rc input:focus {outline:none}
.rc button:focus-visible,.rc a:focus-visible {outline:2px solid #7c5cff;outline-offset:2px}
.rc [tabindex="-1"]:focus {outline:none}
.rc input[type="text"],.rc textarea {display:block;width:100%;margin-top:9px;border:1px solid rgba(17,21,15,.24);border-radius:12px;background:#fff;color:#11150f;padding:12px 14px;font-size:16px;line-height:1.55;outline:none}
.rc input[type="text"] {max-width:420px;min-height:48px;padding:11px 14px}
.rc textarea {min-height:132px;resize:vertical}
.rc input[type="text"]:focus,.rc textarea:focus {border-color:#7c5cff;box-shadow:0 0 0 3px rgba(124,92,255,.22)}
.rc input[aria-invalid="true"],.rc textarea[aria-invalid="true"] {border-color:#97440c}
.rc-region {width:100%;background:#f4f6f5;border-top:1px solid rgba(17,21,15,.14);padding:48px 56px 64px}
.rc-grid {max-width:1128px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 340px;column-gap:48px;align-items:start}
.rc-title {grid-column:1;grid-row:1;min-width:0}
.rc-disclaimer {margin-top:8px!important;font-size:15px;color:#4f5651}
.rc-rules {grid-column:2;grid-row:1 / span 2;position:sticky;top:24px;padding:20px 22px 22px}
.rc-rules>p {margin-top:8px;font-size:15px;line-height:1.55}
.rc-rules ol {padding:0;margin-top:14px;list-style:none;display:flex;flex-direction:column;gap:9px}
.rc-rules li {display:grid;grid-template-columns:20px minmax(0,1fr);gap:6px;font-size:14.5px;line-height:1.5}
.rc-rules li>span:first-child {font-weight:800;font-variant-numeric:tabular-nums}
.rc-discussion {grid-column:1;grid-row:2;min-width:0}
.rc-card {background:#fff;border:1px solid rgba(17,21,15,.12);border-radius:14px}
.rc-form-card {margin-top:22px;padding:22px 24px 20px}
.rc-field-label {display:block;font-size:16px;font-weight:800}
.rc-helper {margin-top:5px!important;font-size:14.5px;color:#4f5651}
.rc-name-field {margin-bottom:18px}
.rc-name-row {display:flex;justify-content:space-between;align-items:center;gap:4px 16px;flex-wrap:wrap}
.rc-name-row>div {min-width:0}
.rc-name-label {font-size:14px;font-weight:700;color:#4f5651}
.rc-name {font-size:16px;font-weight:800;overflow-wrap:anywhere}
.rc-name-status {min-height:22px;margin:2px 0 6px!important;font-size:14.5px;font-weight:700;color:#0f5f37}
.rc-inline-card {padding:14px 16px 16px;background:#f7f8f7;border:1px solid rgba(17,21,15,.1);border-radius:12px}
.rc-inline-card .rc-field-label {font-size:15px}
.rc-inline-card .rc-name-field {margin-bottom:16px}
.rc-inline-card textarea {min-height:112px;padding:11px 13px}
.rc-field-bottom {margin-top:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.rc-field-error {display:flex;align-items:flex-start;gap:8px;font-size:14.5px;line-height:1.45;font-weight:600;color:#97440c}
.rc-error-mark {flex:none;margin-top:2px;width:16px;height:16px;border-radius:50%;background:#97440c;color:#fff;font-size:11px;font-weight:800;display:inline-flex;justify-content:center;align-items:center}
.rc-count {flex:none;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#4f5651}
.rc-count-over {color:#97440c}
.rc-button {min-height:48px;padding:10px 24px;border:1px solid transparent;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;color:#11150f;background:#fff;line-height:1.5}
.rc-button-labels {display:inline-grid}
.rc-button-labels>span {grid-area:1/1}
.rc-green {background:#2ed47e;border-color:#2ed47e;color:#06231a}
.rc-green[aria-busy="true"] {background:#9ee6bf;border-color:#9ee6bf}
.rc-green[aria-disabled="true"]:not([aria-busy="true"]) {background:#e3e7e4;border-color:#e3e7e4;color:#5d635e}
.rc-outline {border-color:rgba(17,21,15,.24);background:#fff}
.rc-dark {background:#11150f;border-color:#11150f;color:#fff}
.rc-dark[aria-busy="true"] {background:#4a504b;border-color:#4a504b}
.rc-text {min-height:44px;padding:10px 12px;border:0;border-radius:10px;background:transparent;font-size:14.5px}
.rc-button[aria-disabled="true"],.rc-close[aria-disabled="true"] {cursor:default}
.rc-inline-card .rc-button {min-height:44px;padding:9px 20px;border-radius:11px;font-size:15px}
.rc-actions {display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;align-items:start}
.rc-post {min-width:180px}
.rc-notice {display:flex;gap:8px;margin-top:14px;padding:13px 15px;background:#fdf4ea;border:1px solid #e9c79a;border-radius:10px;font-size:15px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}
.rc-notice .rc-button {margin-top:10px;min-height:44px;padding:9px 18px;font-size:15px}
.rc-emails {margin:22px 0 0;padding:18px 0 0;border:0;border-top:1px solid rgba(17,21,15,.1);min-width:0}
.rc-emails legend {float:left;width:100%;padding:0;font-size:16px;font-weight:800}
.rc-choices {clear:both;padding-top:6px;margin:0 -10px;display:flex;flex-direction:column;gap:2px}
.rc-choice {display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start;min-height:44px;padding:10px;border-radius:10px;cursor:pointer;font-size:15.5px;line-height:1.45;text-wrap:pretty}
.rc-choice input {margin:1px 0 0;width:20px;height:20px;accent-color:#0f7a45;cursor:inherit}
.rc-choice:has(input:focus-visible) {outline:2px solid #7c5cff;outline-offset:2px}
.rc-choice:has(input[aria-disabled="true"]) {cursor:default}
.rc-preferences-status {margin-top:4px!important;min-height:22px;font-size:14.5px;font-weight:700;color:#0f5f37}
.rc-list {margin-top:30px}
.rc-list-status {min-height:26px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:#4f5651;font-size:14px}
.rc-list-status>span:first-child {font-weight:800}
.rc-list ol {list-style:none;padding:0}
.rc-conversations {margin-top:10px!important;background:#fff;border:1px solid rgba(17,21,15,.1);border-radius:14px}
.rc-conversation+.rc-conversation,.rc-more+.rc-conversation {border-top:1px solid rgba(17,21,15,.1)}
.rc-comment-row {padding:18px 24px 4px}
.rc-reply-row {padding:4px 24px}
.rc-reply-inner {margin-left:28px;padding-left:16px;border-left:2px solid #dde3df}
.rc-reply-composer {margin-left:28px;padding-left:16px;border-left:2px solid #dde3df}
.rc-reply-row:last-child {padding-bottom:20px}
.rc-item-heading {display:flex;align-items:baseline;gap:2px 12px;flex-wrap:wrap}
.rc-item-date {font-size:14px;font-variant-numeric:tabular-nums;color:#4f5651}
.rc-replying {margin-top:4px!important;font-size:14px;font-weight:600;color:#4f5651;overflow-wrap:anywhere}
.rc-body {margin-top:6px!important;font-size:16.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:#1a201d}
.rc-item-actions {margin:2px 0 0 -12px;display:flex;align-items:center;flex-wrap:wrap;gap:0 2px;min-height:44px}
.rc-item-success {padding:0 12px;font-size:14.5px;font-weight:700;color:#0f5f37}
.rc-placeholder {min-height:30px;display:flex;align-items:center;font-size:15px;font-weight:600;color:#4f5651}
.rc-box {margin:10px 0 16px}
.rc-more {padding:18px 24px;border-top:1px solid rgba(17,21,15,.1)}
.rc-more-error {padding:14px 16px;background:#fdf4ea;border:1px solid #e9c79a;border-radius:12px;font-size:15.5px;font-weight:700}
.rc-more-error .rc-button {margin-top:10px;min-height:44px;padding:9px 18px;font-size:15px}
.rc-empty,.rc-load-error {margin-top:10px!important;padding:18px 22px}
.rc-load-error .rc-button {margin-top:12px}
.rc-skeleton {margin-top:10px;padding:18px 22px}
.rc-skeleton-row {height:86px;border-top:1px solid rgba(17,21,15,.08);padding-top:16px}
.rc-skeleton-row::before,.rc-skeleton-row::after {content:'';display:block;background:#eceeed;border-radius:7px;height:12px;margin-top:10px;width:70%}
.rc-skeleton-row::before {width:140px;max-width:100%;height:14px}
.rc-sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.rc-backdrop {position:fixed;inset:0;z-index:10000;background:rgba(10,14,12,.52);display:flex;align-items:center;justify-content:center;padding:32px}
.rc-dialog {width:500px;max-width:100%;max-height:100%;display:flex;flex-direction:column;background:#fff;border-radius:20px;box-shadow:0 30px 80px rgba(10,14,12,.24)}
.rc-dialog-head {display:flex;align-items:flex-start;gap:12px;padding:20px 20px 14px 24px;flex:none}
.rc-dialog-head h2 {flex:1;min-width:0;padding-top:9px;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-.01em}
.rc-close {flex:none;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:11px;color:#4f5651;cursor:pointer}
.rc-dialog-body {flex:1;min-height:0;overflow-y:auto;padding:0 24px 20px}
.rc-excerpt {padding:12px 14px;background:#f5f6f7;border:1px solid rgba(17,21,15,.1);border-radius:10px;overflow-wrap:anywhere}
.rc-excerpt strong {font-size:13.5px;font-weight:800;color:#4f5651;font-variant-numeric:tabular-nums}
.rc-excerpt p {margin-top:5px;font-size:15px;line-height:1.5;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.rc-dialog-actions {display:flex;gap:10px;padding:16px 24px 20px;border-top:1px solid rgba(17,21,15,.08);flex:none}
.rc-stop {min-height:100vh;background:#f5f6f7;display:flex;flex-direction:column}
.rc-stop-header {padding:26px 56px}
.rc-stop main {padding:48px 56px;display:flex;justify-content:center}
.rc-stop-card {width:100%;max-width:520px;background:#fff;border:1px solid rgba(17,21,15,.12);border-radius:20px;padding:40px 40px 34px;box-shadow:0 8px 24px rgba(17,21,15,.05)}
.rc-stop h1 {font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.rc-stop-article {margin-top:10px!important;font-size:16px;color:#4b524b}
.rc a {color:#0f7a45}
.rc-stop-article a {font-weight:700;overflow-wrap:anywhere}
.rc-stop-line {margin-top:14px!important;font-size:16.5px;text-wrap:pretty}
.rc-stop-buttons {margin-top:24px;display:flex;flex-direction:column;gap:12px}
.rc-stop-buttons .rc-button {min-height:52px;font-size:16.5px;padding:12px 20px}
.rc-stop-help {margin-top:20px!important;padding-top:16px;border-top:1px solid rgba(17,21,15,.08);font-size:15px;color:#4f5651;text-wrap:pretty}
@media(hover:hover) and (pointer:fine) and (min-width:768px) {
 .rc-green:not([aria-disabled="true"]):hover {background:#28bf71;border-color:#28bf71}
 .rc-outline:not([aria-disabled="true"]):hover {background:#f7f8fa;border-color:rgba(17,21,15,.3)}
 .rc-dark:not([aria-disabled="true"]):hover {background:#000;border-color:#000}
 .rc-text:not([aria-disabled="true"]):hover {background:#eef3f0}
 .rc-choice:not(:has(input[aria-disabled="true"])):hover {background:#f5f6f7}
 .rc-close:not([aria-disabled="true"]):hover {background:#f1f1f4;color:#11150f}
 .rc a:hover {color:#11832b}
}
@media(max-width:1099px) {
 .rc-region {padding:44px 40px 56px}
 .rc-grid {max-width:720px;grid-template-columns:minmax(0,1fr);gap:0}
 .rc h2 {font-size:26px}
 .rc-title {grid-row:1}
 .rc-rules {grid-column:1;grid-row:2;position:static;margin-top:22px;padding:20px 22px}
 .rc-rules>p {font-size:15.5px}
 .rc-rules li {grid-template-columns:22px minmax(0,1fr);font-size:15px}
 .rc-discussion {grid-row:3}
 .rc-form-card {padding:22px 22px 20px}
 .rc-comment-row {padding:18px 22px 4px}
 .rc-reply-row {padding:4px 22px}
 .rc-reply-inner,.rc-reply-composer {margin-left:24px}
 .rc-stop-header {padding:24px 40px}
 .rc-stop main {padding:44px 40px}
}
@media(max-width:767px) {
 .rc-region {padding:32px 16px 44px}
 .rc h2 {font-size:24px}
 .rc-form-card {padding:18px}
 .rc-actions {flex-direction:column;align-items:stretch}
 .rc-actions .rc-button,.rc-primary,.rc-more .rc-button {width:100%}
 .rc-comment-row {padding:16px 16px 4px}
 .rc-reply-row {padding:4px 16px}
 .rc-reply-inner,.rc-reply-composer {margin-left:12px}
 .rc-reply-row:last-child {padding-bottom:18px}
 .rc-body {font-size:16px}
 .rc-more {padding:16px}
 .rc-backdrop {align-items:flex-end;padding:28px 0 0}
 .rc-dialog {width:100%;border-radius:20px 20px 0 0}
 .rc-dialog-head {padding:22px 22px 14px}
 .rc-dialog-head h2 {font-size:22px}
 .rc-dialog-body {padding:0 22px 18px}
 .rc-dialog-actions {flex-direction:column;padding:14px 22px 22px}
 .rc-stop-header {padding:18px 20px}
 .rc-stop main {padding:16px 16px 32px}
 .rc-stop-card {padding:28px 22px 24px}
 .rc-stop h1 {font-size:26px}
}
`;
