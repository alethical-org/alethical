// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MailResultPosition } from '../MailResultPosition';

it('keeps a visible reading block in place when records arrive above it', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300);
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const top = this.parentElement?.querySelector('article') ? 280 : 80;
      return {
        top,
        bottom: top + 100,
        height: 100,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
  const content = (records: boolean) => (
    <MailResultPosition>
      {records && <article>New records</article>}
      <div data-mail-anchor="text">Reading here</div>
    </MailResultPosition>
  );
  await act(async () => root.render(content(false)));
  await act(async () => root.render(content(true)));
  expect(scroll).toHaveBeenCalledWith({ top: 200, behavior: 'instant' });
  scroll.mockClear();
  await act(async () => root.render(content(true)));
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
  rect.mockRestore();
  vi.restoreAllMocks();
});

it('anchors the app scroll container when the document itself has not scrolled', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 1200 });
  Object.defineProperty(scroller, 'clientHeight', { value: 600 });
  scroller.scrollTop = 300;
  scroller.scrollBy = vi.fn();
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  const root = createRoot(container);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this === scroller ? 0 : this.parentElement?.querySelector('article') ? 280 : 80;
    return {
      top,
      bottom: this === scroller ? 600 : top + 100,
      height: this === scroller ? 600 : 100,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
  const content = (records: boolean) => (
    <MailResultPosition>
      {records && <article>New records</article>}
      <div data-mail-anchor="text">Reading here</div>
    </MailResultPosition>
  );
  await act(async () => root.render(content(false)));
  await act(async () => root.render(content(true)));
  expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 200, behavior: 'instant' });
  await act(async () => root.unmount());
  scroller.remove();
  vi.restoreAllMocks();
});

it('returns focus to surviving evidence when an obsolete record is removed at the top', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
  const content = (oldRecord: boolean) => (
    <MailResultPosition>
      {oldRecord && (
        <article>
          <a href="#old">Old registration</a>
        </article>
      )}
      <section>
        <h2 tabIndex={-1}>Text from your mail</h2>
      </section>
    </MailResultPosition>
  );
  await act(async () => root.render(content(true)));
  container.querySelector('a')!.focus();
  await act(async () => root.render(content(false)));
  expect(document.activeElement).toBe(container.querySelector('h2'));
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
