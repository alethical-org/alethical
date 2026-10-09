import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../data/api';
import { reportCandidateStatement, type CandidateStatement } from '../../data/candidateClaims';
import { useResponsive } from '../../hooks/useResponsive';
import { CandidateButton } from './CandidateControls';
import { statementDateLine } from './profileClaimCopy';

type Status =
  'idle' | 'busy' | 'success' | 'error' | 'limited' | 'changed' | 'reloading' | 'removed';

/** Scoped to public statement reports; claim/manage dialogs keep their own design. */
export function CandidateReportDialog({
  candidateId,
  statement,
  onReload,
  onClose,
  report = reportCandidateStatement,
}: {
  candidateId: string;
  statement: CandidateStatement;
  onReload(signal: AbortSignal): Promise<CandidateStatement | null>;
  onClose(): void;
  report?: typeof reportCandidateStatement;
}) {
  const { isMobile } = useResponsive();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const updatedPanel = useRef<HTMLElement>(null);
  const scope = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [shown, setShown] = useState(statement);
  const [updated, setUpdated] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [viewport, setViewport] = useState({
    top: 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const layer = dialog.current?.parentElement;
    const siblings = [...document.body.children].filter((node) => node !== layer) as HTMLElement[];
    const originalInert = siblings.map((node) => node.inert);
    siblings.forEach((node) => {
      node.inert = true;
    });
    field.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea, [tabindex="0"]',
        ) ?? []),
      ].filter((node) => node.getAttribute('aria-disabled') !== 'true');
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const resize = () =>
      setViewport({
        top: window.visualViewport?.offsetTop ?? 0,
        height: window.visualViewport?.height ?? window.innerHeight,
      });
    document.addEventListener('keydown', keydown);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      scope.current?.abort();
      document.removeEventListener('keydown', keydown);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      document.body.style.overflow = originalOverflow;
      siblings.forEach((node, index) => {
        node.inert = originalInert[index];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (status !== 'limited' || waitUntil === null) return;
    const remaining = waitUntil - Date.now();
    const timer = window.setTimeout(
      () => {
        setStatus('idle');
        setWaitUntil(null);
      },
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [status, waitUntil]);
  useEffect(() => {
    if (!field.current) return;
    field.current.style.height = '0px';
    field.current.style.height = `${Math.min(isMobile ? 264 : 432, Math.max(isMobile ? 168 : 216, field.current.scrollHeight))}px`;
  }, [reason, isMobile, status]);

  const submit = async () => {
    if (
      scope.current ||
      ['busy', 'limited', 'changed', 'reloading', 'removed', 'success'].includes(status)
    )
      return;
    const error = !reason.trim()
      ? 'Enter a reason'
      : Array.from(reason).length > 2000
        ? 'Shorten your reason to 2000 characters or fewer'
        : null;
    setInvalid(error);
    if (error) {
      field.current?.focus();
      return;
    }
    const controller = new AbortController();
    scope.current = controller;
    setStatus('busy');
    try {
      const response = await report(candidateId, reason.trim(), shown.version, controller.signal);
      if (!controller.signal.aborted) setStatus(response.received ? 'success' : 'error');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 409) setStatus('changed');
      else if (error instanceof ApiError && error.status === 404) setStatus('removed');
      else if (error instanceof ApiError && error.status === 429) {
        setWaitUntil(
          error.retryAfterSeconds === null ? null : Date.now() + error.retryAfterSeconds * 1000,
        );
        setStatus('limited');
      } else setStatus('error');
    } finally {
      if (scope.current === controller) scope.current = null;
    }
  };
  const reload = async () => {
    if (scope.current) return;
    const controller = new AbortController();
    scope.current = controller;
    setStatus('reloading');
    setReloadFailed(false);
    try {
      const latest = await onReload(controller.signal);
      if (controller.signal.aborted) return;
      if (!latest) setStatus('removed');
      else {
        setShown(latest);
        setUpdated(true);
        setStatus('idle');
        // The person reads the new version first; Submit report needs its own press.
        window.requestAnimationFrame(() => updatedPanel.current?.focus());
      }
    } catch {
      if (!controller.signal.aborted) {
        setStatus('changed');
        setReloadFailed(true);
      }
    } finally {
      if (scope.current === controller) scope.current = null;
    }
  };
  return createPortal(
    <div
      className="candidate-report-layer"
      style={{
        top: viewport.top,
        height: viewport.height,
        alignItems: isMobile ? 'flex-end' : 'flex-start',
        padding: isMobile ? 0 : `${Math.min(90, viewport.height * 0.12)}px 20px 20px`,
      }}
    >
      <style>{`
        .candidate-report-layer{position:fixed;left:0;right:0;z-index:10000;background:rgba(10,14,12,.42);display:flex;justify-content:center;box-sizing:border-box;font-family:'Libre Franklin',sans-serif;color:#11150f}
        .candidate-report-dialog{position:relative;box-sizing:border-box;width:100%;max-width:520px;max-height:100%;overflow:auto;overscroll-behavior:contain;background:white;box-shadow:0 30px 80px rgba(10,14,12,.35)}
        .candidate-report-dialog button:focus-visible,.candidate-report-dialog [role=button]:focus-visible,.candidate-report-updated:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
        .candidate-report-close{position:absolute;width:44px;height:44px;border:0;border-radius:10px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer}
        .candidate-report-close:active{background:#e6e9e7}
        .candidate-report-reason{box-sizing:border-box;margin-top:8px;width:100%;overflow-y:auto;padding:12px 14px;background:white;border:1px solid rgba(17,21,15,.22);border-radius:12px;font:16px/24px 'Libre Franklin',sans-serif;color:#11150f;resize:vertical;outline:none}
        .candidate-report-reason[aria-invalid=true]{border-color:#a3421a}
        .candidate-report-reason:focus{border-color:#5b30d6;box-shadow:0 0 0 3px rgba(91,48,214,.22)}
        @media(hover:hover) and (pointer:fine){.candidate-report-close:hover{background:#f1f3f2}.candidate-report-reason:hover{border-color:rgba(17,21,15,.4)}}
      `}</style>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="candidate-report-dialog"
        style={{
          borderRadius: isMobile ? '20px 20px 0 0' : 18,
          padding: isMobile ? '22px 22px 28px' : '20px 28px 28px',
        }}
      >
        <button
          type="button"
          className="candidate-report-close"
          aria-label="Close"
          onClick={onClose}
          style={{ top: isMobile ? 22 : 20, right: isMobile ? 22 : 20 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6L18 18M18 6L6 18"
              stroke="#11150f"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h2 id={`${id}-title`} style={{ margin: '8px 64px 0 0', fontSize: 22, fontWeight: 800 }}>
          Report this statement
        </h2>
        {status === 'success' ? (
          <div
            role="status"
            style={{
              marginTop: 18,
              padding: '14px 16px',
              background: '#f2fbf6',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              border: '1px solid #bfeacf',
              borderRadius: 12,
              fontWeight: 700,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="9" stroke="#0f7a45" strokeWidth="2" />
              <path
                d="M8 12.5L11 15.5L16.5 9.5"
                stroke="#0f7a45"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Report received
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            style={{ marginTop: 18 }}
          >
            {updated ? (
              <section
                ref={updatedPanel}
                tabIndex={-1}
                aria-labelledby={`${id}-updated`}
                style={{ marginBottom: 18, outline: 'none' }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '2px 14px',
                  }}
                >
                  <h3 id={`${id}-updated`} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    Updated statement
                  </h3>
                  {statementDateLine(shown) ? (
                    <span
                      style={{
                        fontSize: 14.5,
                        fontWeight: 600,
                        color: '#4f5651',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {statementDateLine(shown)}
                    </span>
                  ) : null}
                </div>
                <div
                  tabIndex={0}
                  aria-label="Updated campaign statement"
                  className="candidate-report-updated"
                  style={{
                    marginTop: 8,
                    maxHeight: isMobile ? 160 : 200,
                    overflowY: 'auto',
                    padding: '14px 16px',
                    background: '#f1f2f4',
                    border: '1px solid rgba(17,21,15,0.1)',
                    borderRadius: 12,
                    fontSize: 16,
                    lineHeight: 1.55,
                    color: '#11150f',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {shown.body}
                </div>
              </section>
            ) : null}
            <label
              htmlFor={`${id}-reason`}
              style={{ display: 'block', fontSize: 16, fontWeight: 700 }}
            >
              Reason
            </label>
            <textarea
              ref={field}
              id={`${id}-reason`}
              className="candidate-report-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(null);
              }}
              readOnly={status === 'busy' || status === 'reloading'}
              aria-invalid={!!invalid}
              aria-describedby={`${id}-count ${id}-error`}
              style={{ minHeight: isMobile ? 168 : 216, maxHeight: isMobile ? 264 : 432 }}
            />
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '0 16px',
              }}
            >
              <div
                id={`${id}-error`}
                aria-live="polite"
                style={{ flex: '1 1 240px', minWidth: 0, minHeight: 4 }}
              >
                {invalid ? <ReportMessage>{invalid}</ReportMessage> : null}
              </div>
              <span
                id={`${id}-count`}
                style={{
                  margin: '8px 0 0 auto',
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: Array.from(reason).length > 2000 ? '#a3421a' : '#4f5651',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {Array.from(reason).length} / 2000 characters
              </span>
            </div>
            {status === 'error' ? (
              <ReportMessage role="alert">We couldn’t submit your report</ReportMessage>
            ) : null}
            {status === 'limited' ? (
              <p role="status" style={{ marginTop: 12, fontWeight: 700 }}>
                Please wait before reporting again
              </p>
            ) : null}
            {(status === 'changed' || status === 'reloading') && !reloadFailed ? (
              <ReportMessage role="alert">
                The campaign statement changed. Review the updated statement before submitting your
                report.
              </ReportMessage>
            ) : null}
            {reloadFailed && (status === 'changed' || status === 'reloading') ? (
              <ReportMessage role="alert">We couldn’t load the campaign statement</ReportMessage>
            ) : null}
            {status === 'removed' ? (
              <p role="status" style={{ marginTop: 12 }}>
                The campaign statement is no longer available
              </p>
            ) : null}
            <div style={{ marginTop: 18, minHeight: 48 }}>
              {status === 'changed' || status === 'reloading' ? (
                <CandidateButton
                  label="Reload statement"
                  busyLabel="Reloading statement…"
                  icon="none"
                  busy={status === 'reloading'}
                  onPress={() => void reload()}
                  style={{ width: isMobile ? '100%' : 190, minHeight: 48 }}
                />
              ) : status !== 'limited' && status !== 'removed' ? (
                <CandidateButton
                  label={status === 'error' ? 'Try again' : 'Submit report'}
                  icon="none"
                  busy={status === 'busy'}
                  onPress={() => void submit()}
                  style={{ width: isMobile ? '100%' : 190, minHeight: 48 }}
                />
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ReportMessage({ children, role }: { children: ReactNode; role?: 'alert' }) {
  return (
    <div
      role={role}
      style={{
        marginTop: 12,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 15,
        lineHeight: 1.45,
        fontWeight: 700,
        color: '#a3421a',
        textWrap: 'pretty',
      }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flex: 'none', marginTop: 2 }}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 7.5 V13 M12 16 V16.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{children}</span>
    </div>
  );
}
