// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Linking } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
  Circle: () => <circle />,
  Rect: () => <rect />,
  Line: () => <line />,
}));

import * as Clipboard from 'expo-clipboard';
import { SharePanelContent } from '../SharePanelContent';
import type { ShareContent } from '../../../lib/share';
import { buildShareIntents, nativeShareText } from '../../../lib/shareIntents';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const content: ShareContent = {
  subject: 'committee',
  title: 'A committee name long enough to wrap across several lines without hiding any words',
  description: 'Campaign money from Minnesota’s own filings.',
  url: 'https://www.alethical.com/money/committees/example-12345?tab=gave&year=2026',
};
const platforms = ['Email', 'WhatsApp', 'Facebook', 'LinkedIn', 'X', 'Bluesky'];
const copyError = 'Couldn’t copy the link. Select and copy it from the link field.';

let mount: HTMLDivElement;
let root: Root;

function setDeviceShare(share?: Navigator['share'], canShare?: Navigator['canShare']) {
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
}

function render(
  variant: 'desktop' | 'tablet' | 'phone' = 'desktop',
  value = content,
  onClose = vi.fn(),
) {
  act(() => root.render(<SharePanelContent content={value} variant={variant} onClose={onClose} />));
}

function control(label: string): HTMLElement {
  const element =
    mount.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
    Array.from(mount.querySelectorAll<HTMLElement>('[role="button"],button')).find(
      (button) => button.textContent === label,
    );
  expect(element, `Expected the ${label} control`).not.toBeNull();
  return element!;
}

function copyButton(): HTMLElement {
  const element = Array.from(mount.querySelectorAll<HTMLElement>('[role="button"],button')).find(
    (button) => /^(Copy|Copied|Copy link|Link copied)$/.test(button.textContent ?? ''),
  );
  expect(element).toBeDefined();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset().mockResolvedValue(true);
  setDeviceShare();
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  setDeviceShare();
  vi.restoreAllMocks();
});

describe('shared panel content', () => {
  it.each(['desktop', 'tablet', 'phone'] as const)(
    'keeps all 6 visible destinations in the approved order on %s',
    (variant) => {
      render(variant);
      const destinations = Array.from(mount.querySelectorAll<HTMLElement>('[aria-label]')).filter(
        (element) => /^Share (?:by email|on )/.test(element.getAttribute('aria-label') ?? ''),
      );
      expect(destinations.map((element) => element.textContent)).toEqual(platforms);
      expect(mount.textContent).toContain(content.title);
      expect(mount.textContent).toContain(content.description);
      expect(mount.textContent).not.toContain('Share using another app');
    },
  );

  it.each([
    'bill',
    'legislator',
    'answer',
    'research',
    'guide',
    'committee',
    'principal',
    'lobbyist',
  ] as const)(
    'identifies the %s without replacing its supplied title or description',
    (subject) => {
      render('desktop', { ...content, subject });
      expect(mount.textContent).toContain(`Share this ${subject}`);
      expect(mount.textContent).toContain(content.title);
      expect(mount.textContent).toContain(content.description);
    },
  );

  it('leaves the full supplied address selectable, read-only, and in the number font', () => {
    render();
    const input = mount.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(input!.value).toBe(content.url);
    expect(input!.readOnly).toBe(true);
    expect(input!.disabled).toBe(false);
    const style = window.getComputedStyle(input!);
    expect(style.fontFamily).toContain('Libre Franklin');
    expect(style.fontVariant).toContain('tabular-nums');
    act(() => input!.focus());
    input!.select();
    expect(input!.selectionStart).toBe(0);
    expect(input!.selectionEnd).toBe(content.url.length);
  });

  it('uses the close action supplied by the wrapper', async () => {
    const onClose = vi.fn();
    render('desktop', content, onClose);
    await click(control('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['desktop', 20],
    ['tablet', 26],
    ['phone', 22],
  ] as const)(
    'keeps the %s close button inside equal %ipx top and side padding',
    (variant, inset) => {
      render(variant);
      const close = control('Close');
      const header = close.parentElement!;
      const body = header.parentElement!;
      const bodyStyle = window.getComputedStyle(body);
      const closeStyle = window.getComputedStyle(close);
      expect(bodyStyle.paddingTop).toBe(`${inset}px`);
      expect(bodyStyle.paddingRight).toBe(`${inset}px`);
      expect(bodyStyle.paddingLeft).toBe(`${inset}px`);
      expect(closeStyle.width).toBe('44px');
      expect(closeStyle.height).toBe('44px');
      expect(body.firstElementChild).toBe(header);
      expect(window.getComputedStyle(header).justifyContent).toBe('space-between');
    },
  );

  it.each(['desktop', 'tablet', 'phone'] as const)(
    'shows successful copy wording only after copying succeeds on %s',
    async (variant) => {
      let finishCopy!: (value: boolean) => void;
      vi.mocked(Clipboard.setStringAsync).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishCopy = resolve;
          }),
      );
      render(variant);
      expect(copyButton().textContent).toBe(variant === 'desktop' ? 'Copy' : 'Copy link');
      await click(copyButton());
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(content.url);
      expect(mount.textContent).not.toContain(variant === 'desktop' ? 'Copied' : 'Link copied');
      await act(async () => finishCopy(true));
      expect(copyButton().textContent).toBe(variant === 'desktop' ? 'Copied' : 'Link copied');
    },
  );

  it.each(['false', 'reject'] as const)(
    'offers manual copying when clipboard returns %s',
    async (failure) => {
      if (failure === 'false') vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false);
      else
        vi.mocked(Clipboard.setStringAsync).mockRejectedValue(new Error('Clipboard unavailable'));
      render();
      await click(copyButton());
      expect(mount.textContent).toContain(copyError);
      expect(mount.textContent).not.toContain('Copied');
      expect(mount.querySelector<HTMLInputElement>('input')!.value).toBe(content.url);
      vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
      await click(copyButton());
      expect(mount.textContent).not.toContain(copyError);
      expect(mount.textContent).toContain('Copied');
    },
  );

  it('clears copied feedback when the supplied link changes', async () => {
    render();
    await click(copyButton());
    expect(mount.textContent).toContain('Copied');
    render('desktop', { ...content, url: `${content.url}&page=2` });
    expect(copyButton().textContent).toBe('Copy');
  });
});

describe('device sharing', () => {
  it.each(['desktop', 'tablet', 'phone'] as const)(
    'passes the complete payload on supported %s devices',
    async (variant) => {
      const share = vi.fn().mockResolvedValue(undefined);
      const canShare = vi.fn().mockReturnValue(true);
      setDeviceShare(share, canShare);
      render(variant);
      await click(control('Share using another app'));
      const payload = {
        title: content.title,
        text: nativeShareText(content, false),
        url: content.url,
      };
      expect(canShare).toHaveBeenCalledWith(payload);
      expect(share).toHaveBeenCalledWith(payload);
      expect(mount.textContent).not.toContain('Shared');
    },
  );

  it('works when share exists without the optional capability check', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setDeviceShare(share);
    render();
    await click(control('Share using another app'));
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('hides device sharing when the device rejects this payload', () => {
    setDeviceShare(vi.fn(), vi.fn().mockReturnValue(false));
    render();
    expect(mount.textContent).not.toContain('Share using another app');
  });

  it('treats closing the device chooser as cancellation, not failure or success', async () => {
    setDeviceShare(vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    render();
    const before = mount.textContent;
    await click(control('Share using another app'));
    expect(mount.textContent).toBe(before);
  });

  it('offers another way to share when the device chooser fails', async () => {
    setDeviceShare(vi.fn().mockRejectedValue(new Error('Permission denied')));
    render();
    await click(control('Share using another app'));
    expect(mount.textContent).toMatch(/couldn.t.*share|couldn.t.*sharing|sharing.*unavailable/i);
    expect(mount.textContent).toMatch(/copy.*link/i);
    expect(mount.textContent).not.toContain('Shared');
  });
});

describe('prepared destination links', () => {
  it('keeps research preview text separate from the text sent to another app', async () => {
    const research: ShareContent = {
      subject: 'research',
      title: 'A research title',
      description: 'Published Aug 20, 2026 · records through Jul 20, 2026.',
      previewDescription: 'Published Aug 20, 2026',
      url: 'https://www.alethical.com/read/research/example-research',
    };
    const share = vi.fn().mockResolvedValue(undefined);
    setDeviceShare(share);
    render('desktop', research);
    expect(mount.textContent).toContain(research.previewDescription);
    expect(mount.textContent).not.toContain('records through');
    await click(control('Share using another app'));
    expect(share.mock.calls[0][0].text).toContain(research.description);

    const intents = buildShareIntents(research);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const openEmail = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    for (const [label, url] of [
      ['Share by email', intents.email],
      ['Share on WhatsApp', intents.whatsapp],
      ['Share on Facebook', intents.facebook],
      ['Share on LinkedIn', intents.linkedin],
      ['Share on X', intents.x],
      ['Share on Bluesky', intents.bluesky],
    ]) {
      const destination = control(label);
      if (destination instanceof HTMLAnchorElement) expect(destination.href).toBe(url);
      else {
        await click(destination);
        if (label === 'Share by email') expect(openEmail.mock.calls.at(-1)?.[0]).toBe(url);
        else expect(open.mock.calls.at(-1)?.[0]).toBe(url);
      }
    }
  });
});
