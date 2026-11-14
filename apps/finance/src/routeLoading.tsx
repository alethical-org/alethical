import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { cameByHistory, keepsSearchFocus, savedScroll } from './router';
import { Refused } from './ui/controls';
import { LoadingLine } from './ui/parts';

// Vite remembers attempted CSS preloads, including failed ones. After one fails,
// another route sharing that stylesheet could otherwise render without styles.
// Keep private destinations recoverable through a fresh document/asset manifest.
let preloadFailed = false;
const preloadListeners = new Set<() => void>();
window.addEventListener('vite:preloadError', () => {
  preloadFailed = true;
  for (const listener of preloadListeners) listener();
});
function subscribePreload(listener: () => void) {
  preloadListeners.add(listener);
  return () => {
    preloadListeners.delete(listener);
  };
}
function AssetsReady({ children }: { children: ReactNode }) {
  const failed = useSyncExternalStore(
    subscribePreload,
    () => preloadFailed,
    () => false,
  );
  if (failed) throw new Error('Page assets unavailable; reload the current document');
  return children;
}

/** Capture navigation intent now, but apply it only after the destination commits.
 * A suspended page must not consume its heading focus or history scroll request. */
export function useScreenFocus(screen: string) {
  const request = useRef({ screen, pending: false, preserve: false, scroll: 0 });
  if (request.current.screen !== screen) {
    request.current = {
      screen,
      pending: true,
      preserve: keepsSearchFocus(),
      scroll: (cameByHistory() ? savedScroll() : null) ?? 0,
    };
  }
  return useCallback(() => {
    const current = request.current;
    if (current.screen !== screen || !current.pending) return;
    current.pending = false;
    if (current.preserve) return;
    window.scrollTo(0, current.scroll);
    document
      .querySelector<HTMLElement>('main h1, main[tabindex="-1"]')
      ?.focus({ preventScroll: true });
  }, [screen]);
}

export function ScreenReady({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return children;
}

function reloadPage() {
  // Reload the current address and its current asset manifest. Resetting React.lazy
  // alone cannot recover a cached rejected import or a removed old-deployment chunk.
  window.location.reload();
}

class ScreenError extends Component<
  { children: ReactNode; onReady: () => void; reload: () => void; resetKey: string },
  { failed: boolean; resetKey: string }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    // A record's render error must not poison another record in the same family.
    // Healthy pages keep their mounted state through in-place search navigation.
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ScreenReady onReady={this.props.onReady}>
        <main id="main" className="f-page">
          <h1 tabIndex={-1} className="f-page-title">
            Couldn’t load this page
          </h1>
          <Refused>
            <p>Reload this page to try again</p>
            <div className="f-alert-action">
              <button
                type="button"
                className="f-btn f-btn-secondary f-btn-small"
                onClick={this.props.reload}
              >
                Reload page
              </button>
            </div>
          </Refused>
        </main>
      </ScreenReady>
    );
  }
}

export function DeferredScreen({
  children,
  onReady,
  reload = reloadPage,
  resetKey = '',
}: {
  children: ReactNode;
  onReady: () => void;
  reload?: () => void;
  resetKey?: string;
}) {
  return (
    <ScreenError onReady={onReady} reload={reload} resetKey={resetKey}>
      <Suspense
        fallback={
          <main id="main" className="f-page" aria-busy="true">
            <LoadingLine>Loading page…</LoadingLine>
          </main>
        }
      >
        <AssetsReady>
          <ScreenReady onReady={onReady}>{children}</ScreenReady>
        </AssetsReady>
      </Suspense>
    </ScreenError>
  );
}
