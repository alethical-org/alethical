// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MailPhotoDialog } from '../MailPhotoDialog';

let root: Root;
let container: HTMLDivElement;
let revoke: ReturnType<typeof vi.fn>;
const onClose = vi.fn<() => void>();
const file = new File(['server-confirmed original'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  revoke = vi.fn();
  onClose.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:private-photo'),
    revokeObjectURL: revoke,
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('opens the exact local original in a modal and releases its URL when closed', async () => {
  await act(async () =>
    root.render(createElement(MailPhotoDialog, { file, side: 'front', onClose })),
  );
  expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  expect(container.querySelector('dialog')?.open).toBe(true);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:private-photo');
  await act(async () => container.querySelector('button')?.click());
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(revoke).toHaveBeenCalledWith('blob:private-photo');
});

it('keeps Close available when the local original is missing or the browser cannot read it', async () => {
  await act(async () => root.render(createElement(MailPhotoDialog, { side: 'back', onClose })));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Couldn’t open this photo');
  expect(container.querySelector('img')).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(MailPhotoDialog, { file, side: 'back', onClose })),
  );
  await act(async () => container.querySelector('img')?.dispatchEvent(new Event('error')));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Couldn’t open this photo');
  expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
});

it('uses browser Escape dismissal without leaving the photo open', async () => {
  await act(async () =>
    root.render(createElement(MailPhotoDialog, { file, side: 'front', onClose })),
  );
  await act(async () =>
    container.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
