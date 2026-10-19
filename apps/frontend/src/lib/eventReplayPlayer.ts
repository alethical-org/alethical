import { replayStart, replayTimestamp } from './eventReplay';

interface Player {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
interface YoutubeApi {
  Player: new (
    iframe: HTMLIFrameElement,
    options: { events: { onReady(): void; onError(): void } },
  ) => Player;
}
type YoutubeWindow = Window & { YT?: YoutubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YoutubeApi> | undefined;

function loadYoutube(win: YoutubeWindow): Promise<YoutubeApi> {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const script = win.document.createElement('script');
    const timeout = win.setTimeout(() => fail(), 15000);
    const fail = () => {
      win.clearTimeout(timeout);
      script.remove();
      apiPromise = undefined;
      reject(new Error('YouTube controls unavailable'));
    };
    win.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } finally {
        win.clearTimeout(timeout);
        if (win.YT?.Player) resolve(win.YT);
        else fail();
      }
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    win.document.head.append(script);
  });
  return apiPromise;
}

/** Initial iframe and timestamp links work without this enhancement. */
export function mountEventReplay(root: HTMLElement): () => void {
  const win = root.ownerDocument.defaultView as YoutubeWindow | null;
  const frame = root.querySelector<HTMLIFrameElement>('#replay-player');
  if (!win || !frame) return () => {};
  const duration = Number(root.dataset.replayDuration);
  const status = root.querySelector<HTMLElement>('[data-replay-status]');
  const copyStatus = root.querySelector<HTMLElement>('[data-replay-copy-status]');
  const fallback = root.querySelector<HTMLAnchorElement>('[data-replay-youtube]');
  let player: Player | undefined;
  let ready = false;
  let disposed = false;
  const report = (text: string) => {
    if (status) status.textContent = text;
  };
  const failed = () => {
    ready = false;
    if (!disposed)
      report(
        'If the video does not play here, watch it on YouTube. Topic links still open the selected time.',
      );
  };
  const timer = win.setTimeout(failed, 20000);
  void loadYoutube(win)
    .then((api) => {
      if (disposed) return;
      player = new api.Player(frame, {
        events: {
          onReady: () => {
            if (!disposed) {
              ready = true;
              win.clearTimeout(timer);
              report('');
            }
          },
          onError: failed,
        },
      });
    })
    .catch(failed);
  const seek = (seconds: number) => {
    player!.seekTo(seconds, true);
    if (fallback) {
      const url = new URL(fallback.href);
      url.searchParams.set('t', `${seconds}s`);
      fallback.href = url.href;
    }
    report(`Video set to ${replayTimestamp(seconds)}`);
  };
  const click = async (event: MouseEvent) => {
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-replay-seek],[data-replay-copy]')
        : null;
    if (
      !element ||
      !root.contains(element) ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const isCopy = element.hasAttribute('data-replay-copy');
    const seconds = Number(isCopy ? element.dataset.replayCopy : element.dataset.replaySeek);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= duration) return;
    const url = new URL(win.location.href);
    url.search = '';
    url.searchParams.set('t', String(seconds));
    url.hash = 'watch';
    if (isCopy) {
      try {
        await win.navigator.clipboard.writeText(url.href);
        if (copyStatus) copyStatus.textContent = `Link copied for ${replayTimestamp(seconds)}`;
      } catch {
        if (copyStatus)
          copyStatus.textContent =
            'Could not copy the link. Use the timestamp link’s copy-link menu.';
      }
    } else if (ready) {
      // Let normal links handle startup, blocked scripts, modified clicks and failures.
      try {
        seek(seconds);
      } catch {
        failed();
        return;
      }
      event.preventDefault();
      win.history.pushState(null, '', url);
      const heading = root.querySelector<HTMLElement>('#watch');
      heading?.focus();
      heading?.scrollIntoView({ block: 'start' });
    }
  };
  const pop = () => {
    if (ready) {
      try {
        seek(replayStart(win.location.search, duration));
      } catch {
        failed();
      }
    }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-replay-copy]').forEach((button) => {
    button.hidden = !win.navigator.clipboard?.writeText;
  });
  root.addEventListener('click', click);
  win.addEventListener('popstate', pop);
  return () => {
    disposed = true;
    win.clearTimeout(timer);
    root.removeEventListener('click', click);
    win.removeEventListener('popstate', pop);
    player?.destroy();
  };
}
