import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../data/api';
import {
  inspectCommentEmailStop,
  stopCommentEmails,
  type CommentEmailStopState,
  type StopCommentEmailChoice,
} from '../../data/comments';
import { COMMENTS_CSS, CommentButton, CommentNotice } from '../../components/comments/CommentsUI';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
}

const stoppedHeading = (choice: StopCommentEmailChoice) =>
  choice === 'replies' ? 'Reply emails stopped' : 'Updates for this article stopped';
const choiceEnabled = (state: CommentEmailStopState, choice: StopCommentEmailChoice) =>
  choice === 'replies' ? state.reply_emails : state.article_updates;

export function CommentEmailsScreen() {
  const [token] = useState(readToken);
  const [state, setState] = useState<CommentEmailStopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<'invalid' | 'network' | null>(null);
  const [busy, setBusy] = useState<StopCommentEmailChoice | null>(null);
  const [lastStopped, setLastStopped] = useState<StopCommentEmailChoice | null>(null);
  const [stoppedHere, setStoppedHere] = useState<StopCommentEmailChoice[]>([]);
  const [error, setError] = useState('');
  const gate = useRef(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  const inspect = async () => {
    if (!token) {
      setFailed('invalid');
      setLoading(false);
      return;
    }
    const request = ++sequence.current;
    setLoading(true);
    setFailed(null);
    try {
      const result = await inspectCommentEmailStop(token);
      if (!mounted.current || sequence.current !== request) return;
      setState(result);
      if (!choiceEnabled(result, result.link_choice)) setLastStopped(result.link_choice);
    } catch (cause) {
      if (mounted.current && sequence.current === request)
        setFailed(
          cause instanceof ApiError && [400, 404, 422].includes(cause.status)
            ? 'invalid'
            : 'network',
        );
    } finally {
      if (mounted.current && sequence.current === request) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    // The private bearer token stays in memory, never in a query, referrer, log,
    // browser history entry, or the destination of the article link.
    if (window.location.hash)
      window.history.replaceState(window.history.state, '', window.location.pathname);
    void inspect();
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stop = async (choice: StopCommentEmailChoice) => {
    if (!token || gate.current || !state || !choiceEnabled(state, choice)) return;
    gate.current = true;
    setBusy(choice);
    setError('');
    const request = ++sequence.current;
    try {
      const result = await stopCommentEmails(token, choice);
      if (!mounted.current || sequence.current !== request) return;
      if (choiceEnabled(result, choice)) {
        setError('Couldn’t save your email choices. Try again.');
        return;
      }
      setState(result);
      setLastStopped(choice);
      setStoppedHere((previous) => [...new Set([...previous, choice])]);
      requestAnimationFrame(() => {
        if (mounted.current) heading.current?.focus();
      });
    } catch {
      if (mounted.current && sequence.current === request)
        setError('Couldn’t save your email choices. Try again.');
    } finally {
      gate.current = false;
      if (mounted.current && sequence.current === request) setBusy(null);
    }
  };

  const choices: StopCommentEmailChoice[] =
    state?.link_choice === 'article' ? ['article', 'replies'] : ['replies', 'article'];
  const available = state ? choices.filter((choice) => choiceEnabled(state, choice)) : [];
  const other: StopCommentEmailChoice = lastStopped === 'replies' ? 'article' : 'replies';
  const otherLine =
    state && lastStopped
      ? choiceEnabled(state, other)
        ? other === 'article'
          ? 'You still receive updates for this article, including replies to you'
          : 'You still receive emails when someone replies to you'
        : stoppedHere.includes(other)
          ? stoppedHeading(other)
          : other === 'article'
            ? 'You don’t receive updates for this article'
            : 'You don’t receive reply emails'
      : null;
  const safeArticlePath =
    state && /^\/read\//.test(state.article_path) && !/[?#\\]/.test(state.article_path)
      ? state.article_path
      : '/read';

  return (
    <div className="rc rc-stop">
      <style>{COMMENTS_CSS}</style>
      <header className="rc-stop-header">
        <a
          href="/"
          aria-label="Alethical home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            textDecoration: 'none',
            minHeight: 44,
          }}
        >
          <svg width="34" height="34" viewBox="8 9 84 84" fill="none" aria-hidden="true">
            <path d="M8,92 L46,10 L46,92 Z" fill="#11150f" />
            <path d="M92,92 L54,10 L54,92 Z" fill="#11150f" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: 21, letterSpacing: '.16em', color: '#11150f' }}>
            ALETHICAL
          </span>
        </a>
      </header>
      <main>
        <div className="rc-stop-card">
          <h1 ref={heading} tabIndex={-1}>
            {lastStopped ? stoppedHeading(lastStopped) : 'Comment emails'}
          </h1>
          {loading && (
            <p role="status" className="rc-stop-line">
              Loading email choices…
            </p>
          )}
          {failed && (
            <>
              <CommentNotice>
                {failed === 'invalid'
                  ? 'This email link could not be opened'
                  : 'Email choices could not be loaded'}
              </CommentNotice>
              {failed === 'invalid' ? (
                <p className="rc-stop-line">
                  Open the link from your email again or contact{' '}
                  <a href="mailto:ask@alethical.com">ask@alethical.com</a>
                </p>
              ) : (
                <div className="rc-stop-buttons">
                  <CommentButton
                    label="Try again"
                    kind="outline"
                    onClick={() => {
                      void inspect();
                    }}
                  />
                </div>
              )}
            </>
          )}
          {state && (
            <>
              <p className="rc-stop-article">
                Article:{' '}
                <a href={`${safeArticlePath}#reader-comments`} rel="noreferrer">
                  {state.article_title}
                </a>
              </p>
              {otherLine && <p className="rc-stop-line">{otherLine}</p>}
              <div className="rc-stop-buttons">
                {available.map((choice, index) => (
                  <CommentButton
                    key={choice}
                    label={
                      choice === 'replies' ? 'Stop reply emails' : 'Stop updates for this article'
                    }
                    busyLabel="Saving…"
                    kind={index === 0 ? 'green' : 'outline'}
                    busy={busy === choice}
                    locked={!!busy && busy !== choice}
                    onClick={() => {
                      void stop(choice);
                    }}
                  />
                ))}
              </div>
              {lastStopped && (
                <p className="rc-stop-help">
                  You can turn these emails back on beside the comments after signing in
                </p>
              )}
              {error && <CommentNotice>{error}</CommentNotice>}
              <span role="status" className="rc-sr-only">
                {busy ? 'Saving…' : ''}
              </span>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
