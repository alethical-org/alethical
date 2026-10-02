import { useLayoutEffect, useRef } from 'react';
import { AppFailureView } from './AppErrorBoundary';

/** The existing failure view, with browser-owned modal focus and Escape handling. */
export function AppFailureDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="Sign-in unavailable"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{
        margin: 0,
        padding: 0,
        border: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: 'none',
        maxHeight: 'none',
      }}
    >
      <AppFailureView onReload={() => window.location.reload()} onClose={onClose} />
    </dialog>
  );
}
