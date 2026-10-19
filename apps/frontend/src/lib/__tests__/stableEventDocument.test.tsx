// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderEventPageSnapshot, injectPageSnapshot } from '../pageSnapshot';
import {
  stableEventDocument,
  registerStableEventRetirement,
  retireStableEventDocument,
  clearStableEventHeader,
} from '../stableEventDocument';
import { mountStableEventScroll } from '../stableEventScroll';
import { disposeEventReplay, mountEventReplay } from '../eventReplayPlayer';
import {
  currentWebHistoryEntry,
  initializeWebHistory,
  pushWebHistory,
  readCurrentScrollPosition,
  scrollPositionStorageKey,
} from '../../navigation/webHistory';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const path = '/blog/events/forward-debate-2026';
const article =
  '<article class="replay-content" data-replay-duration="60"><h2 id="watch" tabindex="-1">Watch</h2><iframe id="replay-player"></iframe><a data-replay-seek="20" href="?t=20#watch">0:20</a><p data-replay-status></p></article>';
let bootScript = '';
function install() {
  window.history.replaceState({}, '', path);
  const shell = readFileSync('public/index.html', 'utf8');
  const html = injectPageSnapshot(shell, renderEventPageSnapshot(article, path));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  bootScript = parsed.getElementById('stable-event-scroll-boot')!.textContent!;
  document.body.replaceChildren(
    ...Array.from(parsed.body.children).filter((e) => e.tagName !== 'SCRIPT'),
  );
  document.body.setAttribute('data-stable-event-document', '');
  initializeWebHistory();
  return stableEventDocument(path)!;
}
afterEach(() => {
  retireStableEventDocument();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-comment-return');
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('stable direct-entry event document', () => {
  it('keeps early header focus on its matching real control without stealing later focus', () => {
    const host = install();
    const header = host.querySelector<HTMLElement>('[data-event-nav]')!;
    const link = header.querySelector<HTMLElement>('a')!;
    link.focus();
    const restore = clearStableEventHeader(host);
    const replacement = document.createElement('a');
    replacement.href = '/';
    replacement.textContent = 'Alethical';
    header.append(replacement);
    restore();
    expect(document.activeElement).toBe(replacement);
    const second = clearStableEventHeader(host);
    header.append(replacement);
    host.querySelector<HTMLElement>('#watch')!.focus();
    second();
    expect(document.activeElement?.id).toBe('watch');
  });
  it('permits the actual API-injected boot program under the production script policy', () => {
    install();
    const hash = `sha256-${createHash('sha256').update(bootScript).digest('base64')}`;
    const config = JSON.parse(readFileSync('../../vercel.json', 'utf8'));
    const policies = config.headers
      .flatMap((group: any) => group.headers)
      .filter((h: any) => h.key.toLowerCase() === 'content-security-policy');
    expect(policies).not.toHaveLength(0);
    for (const policy of policies) {
      const scripts = policy.value
        .split(';')
        .find((part: string) => part.trim().startsWith('script-src '));
      expect(scripts.split(/\s+/)).toContain(`'${hash}'`);
    }
  });
  it('lets an active comment return choose its destination instead of an older saved position', () => {
    const host = install();
    const entry = currentWebHistoryEntry()!;
    window.sessionStorage.setItem(scrollPositionStorageKey(entry.sessionId, entry.entryId), '1600');
    document.documentElement.setAttribute('data-comment-return', '');
    window.eval(bootScript);
    expect(host.scrollTop).toBe(0);
    expect(host.dataset.eventPendingScroll).toBeUndefined();
  });
  it.each([
    ['none', 1600, 'wheel'],
    ['before', 800, 'wheel'],
    ['after', 800, 'wheel'],
    ['before', 0, 'wheel'],
    ['before', 0, 'focusin'],
    ['after', 0, 'focusin'],
    ['before', 0, 'keydown'],
    ['after', 0, 'keydown'],
    ['before', 0, 'mousedown'],
    ['after', 0, 'mousedown'],
  ] as const)(
    'retains a deep saved comment position until content arrives, movement=%s target=%s',
    async (stage, expected, input) => {
      const host = install();
      let maximum = 1000;
      let position = 0;
      Object.defineProperty(host, 'scrollTop', {
        configurable: true,
        get: () => position,
        set: (value) => {
          position = Math.min(maximum, Math.max(0, Number(value)));
        },
      });
      const entry = currentWebHistoryEntry()!;
      window.sessionStorage.setItem(
        scrollPositionStorageKey(entry.sessionId, entry.entryId),
        '1600',
      );
      window.eval(bootScript);
      expect(host.scrollTop).toBe(1000);
      expect(host.dataset.eventPendingScroll).toBe('1600');
      if (stage === 'before') {
        (input === 'keydown' ? document.body : host).dispatchEvent(
          new Event(input, { bubbles: true }),
        );
        host.scrollTop = expected;
        host.dispatchEvent(new Event('scroll'));
      }
      const detach = mountStableEventScroll(host, path);
      expect(readCurrentScrollPosition()).toBe(stage === 'before' ? expected : 1600);
      if (stage === 'after') {
        (input === 'keydown' ? document.body : host).dispatchEvent(
          new Event(input, { bubbles: true }),
        );
        host.scrollTop = expected;
        host.dispatchEvent(new Event('scroll'));
      }
      if (stage === 'none') {
        // The browser anchors to existing content while the real header mounts.
        // That scroll event is not a reader choosing a different position.
        host.scrollTop = 995;
        host.dispatchEvent(new Event('scroll'));
        expect(readCurrentScrollPosition()).toBe(1600);
      }
      maximum = 2000;
      host.querySelector('[data-event-discussion]')!.append(document.createElement('p'));
      await vi.waitFor(() => expect(host.scrollTop).toBe(expected));
      expect(readCurrentScrollPosition()).toBe(expected);
      detach();
    },
  );
  it.each([0, 640])(
    'restores saved %s before first paint and preserves later reader movement through startup',
    (saved) => {
      const host = install();
      const entry = currentWebHistoryEntry()!;
      window.sessionStorage.setItem(
        scrollPositionStorageKey(entry.sessionId, entry.entryId),
        String(saved),
      );
      window.eval(bootScript);
      expect(host.scrollTop).toBe(saved);
      host.scrollTop = 913;
      const detach = mountStableEventScroll(host, path);
      expect(host.scrollTop).toBe(913);
      detach();
      expect(readCurrentScrollPosition()).toBe(913);
    },
  );
  it('keeps an untouched saved first-paint position', () => {
    const host = install();
    const entry = currentWebHistoryEntry()!;
    window.sessionStorage.setItem(scrollPositionStorageKey(entry.sessionId, entry.entryId), '640');
    window.eval(bootScript);
    const detach = mountStableEventScroll(host, path);
    expect(host.scrollTop).toBe(640);
    detach();
  });
  it('keeps the iframe outside the replaced app root and matches the exact event address', () => {
    const host = install();
    const frame = host.querySelector('iframe')!;
    const context = frame.contentWindow;
    expect(document.querySelector('#root iframe')).toBeNull();
    expect(host.querySelector('main')?.className).toBe('');
    expect(host.querySelector('main')?.closest('.page-snapshot')).toBeNull();
    expect(host.querySelector('[data-event-nav] > .page-snapshot')).not.toBeNull();
    expect(stableEventDocument('/blog/events/another')).toBeNull();
    const root = createRoot(document.getElementById('root')!);
    act(() => root.render(<p>Application mounted</p>));
    expect(document.getElementById('replay-player')).toBe(frame);
    expect(frame.contentWindow).toBe(context);
    act(() => root.unmount());
  });
  it('reveals app recovery even when player retirement throws, including before any claim', () => {
    const host = install();
    const cleanup = vi.fn(() => {
      throw new Error('player unavailable');
    });
    registerStableEventRetirement(host, cleanup);
    retireStableEventDocument();
    retireStableEventDocument();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(document.body.hasAttribute('data-stable-event-document')).toBe(false);
    install();
    retireStableEventDocument();
    expect(document.getElementById('stable-event-document')).toBeNull();
  });
  it('preserves pre-startup reading and saves the outgoing entry after navigation has changed the address', () => {
    const host = install();
    host.scrollTop = 913;
    const first = currentWebHistoryEntry()!;
    const detach = mountStableEventScroll(host, path);
    expect(host.scrollTop).toBe(913);
    pushWebHistory('/money');
    host.scrollTop = 970;
    detach();
    expect(
      window.sessionStorage.getItem(scrollPositionStorageKey(first.sessionId, first.entryId)),
    ).toBe('970');
    expect(readCurrentScrollPosition()).toBe(0);
  });
  it('reuses the player across effect cleanup and Back, and retires it only when the document leaves', async () => {
    const host = install();
    const root = host.querySelector<HTMLElement>('.replay-content')!;
    const frame = root.querySelector<HTMLIFrameElement>('iframe')!;
    const seekTo = vi.fn();
    const destroy = vi.fn(() => frame.remove());
    const Player = vi.fn(function (_frame: HTMLIFrameElement, options: any) {
      options.events.onReady();
      return { seekTo, destroy };
    });
    Object.assign(window, { YT: { Player } });
    root.querySelector<HTMLElement>('#watch')!.scrollIntoView = vi.fn();
    const first = window.history.state;
    const detach = mountEventReplay(root);
    await Promise.resolve();
    detach();
    const detachAgain = mountEventReplay(root);
    expect(Player).toHaveBeenCalledTimes(1);
    expect(frame.isConnected).toBe(true);
    root.querySelector<HTMLAnchorElement>('a')!.click();
    expect(currentWebHistoryEntry()?.entryId).not.toBe(first.__alethical.entryId);
    expect(seekTo).toHaveBeenLastCalledWith(20, true);
    seekTo.mockClear();
    window.history.replaceState(first, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seekTo).not.toHaveBeenCalled();
    window.history.replaceState(first, '', `${path}?t=10`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seekTo).toHaveBeenLastCalledWith(10, true);
    seekTo.mockClear();
    window.history.replaceState(first, '', '/money?t=10');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seekTo).not.toHaveBeenCalled();
    expect(document.getElementById('replay-player')).toBe(frame);
    registerStableEventRetirement(host, () => {
      detachAgain();
      disposeEventReplay(root);
    });
    retireStableEventDocument(host);
    detachAgain();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
