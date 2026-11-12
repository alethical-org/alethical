import { useLayoutEffect, useRef, useState } from 'react';
import type { MailImageSide } from '../data/mailUpload';
import { useMailPhoto } from '../hooks/useMailPhoto';

type Position = { scale: number; x: number; y: number };
const fitted: Position = { scale: 1, x: 0, y: 0 };
const maximumScale = 16;

/** Native modal focus and private original bytes; transforms never alter the file. */
export function MailPhotoDialog({
  file,
  side,
  onClose,
}: {
  file?: File;
  side: MailImageSide;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const preview = useMailPhoto(file);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState(fitted);
  const current = useRef(position);
  const pointers = useRef(
    new Map<number, { x: number; y: number; startX: number; startY: number; moved: boolean }>(),
  );
  const multiTouch = useRef(false);
  const lastPointerType = useRef('mouse');
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const factor =
    natural.width && size.width
      ? Math.min(size.width / natural.width, size.height / natural.height)
      : 0;
  const width = natural.width * factor;
  const height = natural.height * factor;
  const unavailable = failed || preview.failed;
  const ready = !!preview.url && !!width && !unavailable;
  const move = (next: Position) => {
    const scale = Math.max(1, Math.min(maximumScale, next.scale));
    const maxX = Math.max(0, (width * scale - size.width) / 2);
    const maxY = Math.max(0, (height * scale - size.height) / 2);
    current.current = {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    setPosition(current.current);
  };
  const zoom = (by: number, x = 0, y = 0) => {
    if (!ready) return;
    const old = current.current;
    const scale = Math.max(1, Math.min(maximumScale, old.scale * by));
    const ratio = scale / old.scale;
    move({ scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  };
  const fit = () => move(fitted);
  const offset = (x: number, y: number) => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 };
  };
  useLayoutEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    node?.showModal();
    close.current?.focus({ preventScroll: true });
    return () => {
      node?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
      current.current = fitted;
      setPosition(fitted);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <dialog
      className="mail-photo-dialog"
      ref={dialog}
      aria-labelledby="mail-photo-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Native dialogs can send end-of-loop Tab to browser chrome. Keep the
        // photo's keyboard controls together, including inactive zoom limits.
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
        ];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[next]?.focus();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mail-photo-panel">
        <div className="mail-photo-heading">
          <h2 id="mail-photo-title">{side === 'front' ? 'Front' : 'Back'}</h2>
          <button
            ref={close}
            className="mail-photo-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div
          className="mail-photo-image-area"
          ref={viewport}
          tabIndex={0}
          aria-label={`${side === 'front' ? 'Front' : 'Back'} photo`}
          style={{ cursor: position.scale > 1 ? 'grab' : 'default' }}
          onKeyDown={(event) => {
            if (!ready) return;
            const pans: Record<string, [number, number]> = {
              ArrowLeft: [40, 0],
              ArrowRight: [-40, 0],
              ArrowUp: [0, 40],
              ArrowDown: [0, -40],
            };
            if (pans[event.key]) {
              event.preventDefault();
              const [x, y] = pans[event.key];
              move({ ...current.current, x: current.current.x + x, y: current.current.y + y });
            } else if (['+', '=', '-', '_', 'Home'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'Home') fit();
              else zoom(event.key === '+' || event.key === '=' ? 1.5 : 1 / 1.5);
            }
          }}
          onDoubleClick={(event) => {
            if (lastPointerType.current === 'mouse') {
              const point = offset(event.clientX, event.clientY);
              zoom(2, point.x, point.y);
            }
          }}
          onPointerDown={(event) => {
            lastPointerType.current = event.pointerType;
            if (!ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
            });
            if (pointers.current.size > 1) multiTouch.current = true;
          }}
          onPointerMove={(event) => {
            const previous = pointers.current.get(event.pointerId);
            if (!previous || !ready) return;
            const before = [...pointers.current.values()];
            pointers.current.set(event.pointerId, {
              ...previous,
              x: event.clientX,
              y: event.clientY,
              moved:
                previous.moved ||
                Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 8,
            });
            const after = [...pointers.current.values()];
            if (after.length === 2) {
              const distance = (p: typeof after) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
              const oldDistance = distance(before);
              if (!oldDistance) return;
              const old = current.current;
              const scale = Math.max(
                1,
                Math.min(maximumScale, (old.scale * distance(after)) / oldDistance),
              );
              const first = offset(
                (before[0].x + before[1].x) / 2,
                (before[0].y + before[1].y) / 2,
              );
              const second = offset((after[0].x + after[1].x) / 2, (after[0].y + after[1].y) / 2);
              const ratio = scale / old.scale;
              move({
                scale,
                x: second.x - (first.x - old.x) * ratio,
                y: second.y - (first.y - old.y) * ratio,
              });
            } else if (after.length === 1)
              move({
                ...current.current,
                x: current.current.x + event.clientX - previous.x,
                y: current.current.y + event.clientY - previous.y,
              });
          }}
          onPointerUp={(event) => {
            const point = pointers.current.get(event.pointerId);
            if (point && !point.moved && !multiTouch.current && event.pointerType === 'touch') {
              const now = Date.now();
              const old = lastTap.current;
              if (
                old &&
                now - old.time < 320 &&
                Math.hypot(old.x - point.x, old.y - point.y) < 24
              ) {
                const center = offset(point.x, point.y);
                zoom(2, center.x, center.y);
                lastTap.current = null;
              } else lastTap.current = { time: now, x: point.x, y: point.y };
            }
            pointers.current.delete(event.pointerId);
            if (!pointers.current.size) multiTouch.current = false;
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId);
            lastTap.current = null;
            if (!pointers.current.size) multiTouch.current = false;
          }}
        >
          {unavailable ? (
            <div className="mail-photo-failed">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="3.5"
                  y="4.5"
                  width="17"
                  height="15"
                  rx="2.5"
                  stroke="#4f5651"
                  strokeWidth="1.8"
                />
                <circle cx="9" cy="9.5" r="1.8" stroke="#4f5651" strokeWidth="1.6" />
                <path
                  d="M4 17L9.5 12.5L13 15.5L16 13L20 16.5"
                  stroke="#4f5651"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div role="alert" className="mail-photo-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 8V13M12 16.5V16.6M4 20H20L13.7 5A2 2 0 0 0 10.3 5Z"
                    stroke="#a76a1a"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Couldn’t open this photo</span>
              </div>
            </div>
          ) : (
            <>
              {!ready && <p role="status">Loading photo</p>}
              {preview.url && (
                <img
                  src={preview.url}
                  alt={`${side === 'front' ? 'Front' : 'Back'} of your mail`}
                  draggable={false}
                  onLoad={(event) =>
                    setNatural({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setFailed(true)}
                  style={{
                    width,
                    height,
                    marginLeft: -width / 2,
                    marginTop: -height / 2,
                    transform: `translate(${position.x}px, ${position.y}px) scale(${position.scale})`,
                  }}
                />
              )}
            </>
          )}
        </div>
        <div className="mail-photo-tools">
          <button
            type="button"
            aria-disabled={!ready || position.scale <= 1}
            onClick={() => zoom(1 / 1.5)}
          >
            <ZoomIcon />
            Zoom out
          </button>
          <button
            type="button"
            aria-disabled={!ready || position.scale >= maximumScale}
            onClick={() => zoom(1.5)}
          >
            <ZoomIcon plus />
            Zoom in
          </button>
          <button
            type="button"
            aria-disabled={!ready || position.scale <= 1}
            onClick={() => {
              if (ready) fit();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 9V5A1 1 0 0 1 5 4H9M15 4H19A1 1 0 0 1 20 5V9M20 15V19A1 1 0 0 1 19 20H15M9 20H5A1 1 0 0 1 4 19V15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Fit photo
          </button>
        </div>
      </div>
    </dialog>
  );
}
function ZoomIcon({ plus = false }: { plus?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path
        d={`M7.5 10.5H13.5M15.5 15.5L20 20${plus ? 'M10.5 7.5V13.5' : ''}`}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
