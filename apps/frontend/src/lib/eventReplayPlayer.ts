import { replayStart, replayTimestamp } from './eventReplay';
import { pushWebHistory, saveCurrentScrollPosition } from '../navigation/webHistory';

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
interface Controller {
  player?: Player;
  ready: boolean;
  failed: boolean;
  disposed: boolean;
  notify: Set<() => void>;
  timer: number;
}
const controllers = new WeakMap<HTMLIFrameElement, Controller>();

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

function controllerFor(frame: HTMLIFrameElement, win: YoutubeWindow): Controller {
  const existing = controllers.get(frame);
  if (existing) return existing;
  const state: Controller = {
    ready: false,
    failed: false,
    disposed: false,
    notify: new Set(),
    timer: 0,
  };
  controllers.set(frame, state);
  const changed = () => state.notify.forEach((notify) => notify());
  const fail = () => {
    if (state.disposed) return;
    state.ready = false;
    state.failed = true;
    win.clearTimeout(state.timer);
    changed();
  };
  state.timer = win.setTimeout(fail, 20000);
  void loadYoutube(win)
    .then((api) => {
      if (state.disposed) return;
      state.player = new api.Player(frame, {
        events: {
          onReady: () => {
            if (state.disposed) return;
            state.ready = true;
            state.failed = false;
            win.clearTimeout(state.timer);
            changed();
          },
          onError: fail,
        },
      });
    })
    .catch(fail);
  return state;
}

function disposeFrame(frame: HTMLIFrameElement) {
  const state = controllers.get(frame);
  if (!state) return;
  state.disposed = true;
  frame.ownerDocument.defaultView?.clearTimeout(state.timer);
  state.notify.clear();
  state.player?.destroy();
  controllers.delete(frame);
}

/** Retiring an article, unlike replaying an effect, may remove its player. */
export function disposeEventReplay(root: HTMLElement) {
  const frame = root.querySelector<HTMLIFrameElement>('#replay-player');
  if (frame) disposeFrame(frame);
}

export function replayScroller(root: HTMLElement): HTMLElement | null {
  for (let node = root.parentElement; node; node = node.parentElement) {
    if (root.ownerDocument.defaultView?.getComputedStyle(node).overflowY === 'auto') return node;
  }
  return null;
}

/** Initial iframe and timestamp links work without this enhancement. */
export function mountEventReplay(root: HTMLElement, expectedPath?: string): () => void {
  const win = root.ownerDocument.defaultView as YoutubeWindow | null;
  const frame = root.querySelector<HTMLIFrameElement>('#replay-player');
  if (!win) return () => {};
  if (!frame) {
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href^="#topic-"]')
          : null;
      if (!link || !root.contains(link)) return;
      const heading = root.querySelector<HTMLElement>(link.getAttribute('href')!);
      const scroller = replayScroller(root);
      if (!heading || !scroller) return;
      event.preventDefault();
      saveCurrentScrollPosition(scroller.scrollTop);
      const url = new URL(win.location.href);
      url.hash = link.hash;
      pushWebHistory(`${url.pathname}${url.search}${url.hash}`);
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
      saveCurrentScrollPosition(scroller.scrollTop);
    };
    root.addEventListener('click', click);
    return () => root.removeEventListener('click', click);
  }
  const state = controllerFor(frame, win);
  const path = expectedPath ?? win.location.pathname;
  const duration = Number(root.dataset.replayDuration);
  const status = root.querySelector<HTMLElement>('[data-replay-status]');
  const copyStatus = root.querySelector<HTMLElement>('[data-replay-copy-status]');
  const fallback = root.querySelector<HTMLAnchorElement>('[data-replay-youtube]');
  let disposed = false;
  const report = (text: string) => {
    if (status) status.textContent = text;
  };
  const failed = () => {
    state.ready = false;
    state.failed = true;
    if (!disposed)
      report(
        'If the video does not play here, watch it on YouTube. Topic links still open the selected time.',
      );
  };
  const changed = () => {
    if (state.ready) report('');
    else if (state.failed) failed();
  };
  state.notify.add(changed);
  changed();
  const seek = (seconds: number) => {
    state.player!.seekTo(seconds, true);
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
    } else if (state.ready) {
      // Let normal links handle startup, blocked scripts, modified clicks and failures.
      try {
        seek(seconds);
      } catch {
        failed();
        return;
      }
      event.preventDefault();
      const scroller = replayScroller(root);
      if (scroller) saveCurrentScrollPosition(scroller.scrollTop);
      // This article is public and has no unsaved editor state. Guarded editor
      // screens must keep their own removal-aware history writer.
      pushWebHistory(`${url.pathname}${url.search}${url.hash}`);
      const heading = root.querySelector<HTMLElement>('#watch');
      heading?.focus();
      heading?.scrollIntoView({ block: 'start' });
      if (scroller) saveCurrentScrollPosition(scroller.scrollTop);
    }
  };
  const pop = () => {
    const raw = new URLSearchParams(win.location.search).get('t');
    if (
      win.location.pathname !== path ||
      raw === null ||
      !/^\d+(?:\.\d+)?$/.test(raw) ||
      Number(raw) >= duration
    )
      return;
    if (state.ready) {
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
    state.notify.delete(changed);
    root.removeEventListener('click', click);
    win.removeEventListener('popstate', pop);
    // React effect replays leave the iframe connected. Actual ordinary-screen
    // removal or explicit stable-host retirement owns destruction instead.
    if (!frame.isConnected) disposeFrame(frame);
  };
}
