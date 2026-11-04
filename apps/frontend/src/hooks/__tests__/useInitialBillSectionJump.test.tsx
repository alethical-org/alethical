// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInitialBillSectionJump } from '../useInitialBillSectionJump';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let mount: HTMLDivElement;
const jump = vi.fn();

function Reader({
  bill,
  section,
  loading = false,
}: {
  bill?: { id: string };
  section: string | null;
  loading?: boolean;
}) {
  useInitialBillSectionJump(!loading ? bill?.id : undefined, section, jump);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  jump.mockClear();
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  vi.useRealTimers();
});

it('keeps a pending shared link through refreshed bill/vote objects and StrictMode cleanup', () => {
  act(() =>
    root.render(
      <StrictMode>
        <Reader bill={{ id: 'HF4138' }} section="fulltext" />
      </StrictMode>,
    ),
  );
  act(() => vi.advanceTimersByTime(20));
  act(() =>
    root.render(
      <StrictMode>
        <Reader bill={{ id: 'HF4138' }} section="fulltext" />
      </StrictMode>,
    ),
  );
  act(() => vi.advanceTimersByTime(200));
  expect(jump).toHaveBeenCalledExactlyOnceWith('fulltext');
  act(() =>
    root.render(
      <StrictMode>
        <Reader bill={{ id: 'HF4138' }} section="fulltext" />
      </StrictMode>,
    ),
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(jump).toHaveBeenCalledTimes(1);
});

it('waits for the bill and follows a changed address without applying a cancelled old jump', () => {
  act(() => root.render(<Reader section="votes" />));
  act(() => vi.advanceTimersByTime(1000));
  expect(jump).not.toHaveBeenCalled();
  act(() => root.render(<Reader bill={{ id: 'HF4138' }} section="votes" />));
  act(() => vi.advanceTimersByTime(20));
  act(() => root.render(<Reader bill={{ id: 'HF719' }} section="actions" />));
  act(() => vi.advanceTimersByTime(200));
  expect(jump).toHaveBeenCalledExactlyOnceWith('actions');
  act(() => root.render(<Reader bill={{ id: 'HF719' }} section="fulltext" />));
  act(() => vi.advanceTimersByTime(200));
  expect(jump.mock.calls).toEqual([['actions'], ['fulltext']]);
});

it('does not scroll after the bill page unmounts or when no valid section was requested', () => {
  act(() => root.render(<Reader bill={{ id: 'HF4138' }} section={null} />));
  act(() => vi.advanceTimersByTime(200));
  expect(jump).not.toHaveBeenCalled();
  act(() => root.render(<Reader bill={{ id: 'HF4138' }} section="fulltext" />));
  act(() => root.render(null));
  act(() => vi.advanceTimersByTime(200));
  expect(jump).not.toHaveBeenCalled();
});

it('waits for slow votes to reveal the sections even when the bill already arrived', () => {
  act(() => root.render(<Reader bill={{ id: 'HF4138' }} section="fulltext" loading />));
  act(() => vi.advanceTimersByTime(1000));
  expect(jump).not.toHaveBeenCalled();
  act(() => root.render(<Reader bill={{ id: 'HF4138' }} section="fulltext" />));
  act(() => vi.advanceTimersByTime(200));
  expect(jump).toHaveBeenCalledExactlyOnceWith('fulltext');
});
