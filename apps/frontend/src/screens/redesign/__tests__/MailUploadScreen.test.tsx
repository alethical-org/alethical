// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { useMailUpload } from '../../../hooks/useMailUpload';

const state = vi.hoisted(() => ({ form: vi.fn() }));
vi.mock('../../../hooks/useMailUpload', () => ({ useMailUpload: state.form }));
vi.mock('../../../theme/primitives', async () => {
  const { createElement } = await import('react');
  return {
    PageBackground: ({ children }: { children: React.ReactNode }) =>
      createElement('div', null, children),
    TopNav: () => null,
    Footer: () => null,
  };
});
vi.mock('../../../navigation/topNavRoutes', () => ({ navigateTopNavItem: vi.fn() }));
import { MailUploadScreen } from '../MailUploadScreen';

let root: Root;
let container: HTMLDivElement;
let form: ReturnType<typeof useMailUpload>;
const receipt = { sha256: 'a'.repeat(64), bytes: 5, content_type: 'image/jpeg' };
const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
function makeForm(): ReturnType<typeof useMailUpload> {
  return {
    access: 'ready',
    checkAccess: vi.fn(),
    photos: { front: { busy: false }, back: { busy: false } },
    likes: null,
    setLikes: vi.fn(),
    comment: '',
    setComment: vi.fn(),
    errors: {},
    status: 'editing',
    failure: '',
    savedSubmission: null,
    upload: vi.fn(),
    submit: vi.fn(),
    reset: vi.fn(),
  };
}
async function render() {
  state.form.mockReturnValue(form);
  const props = { navigation: { navigate: vi.fn() } } as unknown as ComponentProps<
    typeof MailUploadScreen
  >;
  await act(async () => root.render(createElement(MailUploadScreen, props)));
}
const button = (name: string) =>
  Array.from(container.querySelectorAll('button')).find((item) => item.textContent === name)!;

function useMobilePicker() {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  form = makeForm();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('passes the selected side and File directly to the upload flow', async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [photo] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(form.upload).toHaveBeenCalledWith('front', photo);
  expect(input.value).toBe('');
});

it('keeps the form in place while connecting and enables it when ready', async () => {
  form.access = 'loading';
  await render();
  const front = container.querySelector<HTMLButtonElement>('#front-photo');
  expect(front?.disabled).toBe(true);
  expect(button('Submit').disabled).toBe(true);
  expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  expect(container.textContent).not.toContain('Loading…');
  await act(async () =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(form.submit).not.toHaveBeenCalled();

  form.access = 'ready';
  await render();
  expect(container.querySelector('#front-photo')).toBe(front);
  expect(front?.disabled).toBe(false);
  expect(button('Submit').disabled).toBe(false);
});

it('opens the rear camera or photo library for the side chosen on mobile', async () => {
  useMobilePicker();
  await render();

  for (const [side, source] of [
    ['front', 'Take photo'],
    ['back', 'Choose photo'],
  ] as const) {
    const trigger = container.querySelector<HTMLButtonElement>(`#${side}-photo`)!;
    const input = trigger
      .closest('.photo')!
      .querySelector<HTMLInputElement>(
        source === 'Take photo'
          ? 'input[capture="environment"]'
          : 'input[type="file"]:not([capture])',
      );
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button('Take photo'));
    expect(input).toBeTruthy();
    const openPicker = vi.spyOn(input!, 'click');
    await act(async () => button(source).click());
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('[role="menu"]')).toBeNull();

    Object.defineProperty(input, 'files', { value: [photo] });
    await act(async () => input!.dispatchEvent(new Event('change', { bubbles: true })));
    expect(form.upload).toHaveBeenLastCalledWith(side, photo);
  }
});

it('moves between photo sources by keyboard and restores focus when dismissed', async () => {
  useMobilePicker();
  await render();
  const trigger = container.querySelector<HTMLButtonElement>('#front-photo')!;
  await act(async () => trigger.click());
  await act(async () => {
    button('Take photo').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(button('Choose photo'));
  await act(async () => {
    button('Choose photo').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('shows a check only for a confirmed photo and disables Submit during photo transfer', async () => {
  form.photos.front = { busy: true, file: photo };
  form.photos.back = { busy: false, receipt, confirmedFile: photo };
  await render();
  expect(container.querySelectorAll('.image.confirmed .check')).toHaveLength(1);
  expect(container.textContent).toContain('Front photo uploading');
  expect(container.textContent).toContain('Back photo uploaded');
  expect(button('Submit').disabled).toBe(true);
});

it('retries the retained failed replacement without reopening the picker', async () => {
  form.photos.front = {
    busy: false,
    receipt,
    confirmedFile: photo,
    file: photo,
    error: 'Upload failed',
  };
  await render();
  expect(container.querySelector('.image.confirmed')).toBeNull();
  await act(async () => button('Try again').click());
  expect(form.upload).toHaveBeenCalledWith('front', photo);
  expect(button('Replace photo')).toBeTruthy();
});

it.each(['Couldn’t open this photo', 'Choose a photo smaller than 15 MB'])(
  'photo recovery: %s offers a focused chooser, never retries rejected bytes',
  async (error) => {
    form.photos.front = { busy: false, receipt, confirmedFile: photo, error };
    form.errors = { front: 'Add a front photo' };
    await render();
    expect(button('Try again')).toBeUndefined();
    const chooser = button('Choose another photo');
    expect(chooser).toBeTruthy();
    expect(chooser.getAttribute('aria-label')).toBe('Choose another front photo');
    expect(document.activeElement).toBe(chooser);
    expect(container.querySelector('.image.confirmed')).toBeNull();
    expect(container.querySelector('.photo-failure')).toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click');
    await act(async () => chooser.click());
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(form.upload).not.toHaveBeenCalled();
  },
);

it('locks edits during an uncertain save while leaving its safe retry available', async () => {
  form.status = 'retry';
  form.failure = 'Couldn’t confirm your upload';
  form.comment = 'Preserved comment';
  await render();
  expect(container.querySelector('fieldset')?.disabled).toBe(true);
  expect(container.querySelector('textarea')?.disabled).toBe(true);
  expect(container.querySelector('textarea')?.value).toBe('Preserved comment');
  expect(container.querySelector<HTMLButtonElement>('#front-photo')?.disabled).toBe(true);
  expect(button('Try again').disabled).toBe(false);
  await act(async () => button('Try again').click());
  expect(form.submit).toHaveBeenCalledTimes(1);
});

it('disables the submit control while saving', async () => {
  form.status = 'sending';
  await render();
  expect(button('Submitting…').disabled).toBe(true);
  await act(async () => button('Submitting…').click());
  expect(form.submit).not.toHaveBeenCalled();
});

it('moves focus to Saved and starts another form through its explicit action', async () => {
  form.status = 'saved';
  await render();
  expect(document.activeElement).toBe(container.querySelector('#mail-saved'));
  expect(container.querySelector('form')).toBeNull();
  await act(async () => button('Upload another').click());
  expect(form.reset).toHaveBeenCalledTimes(1);
});

it('focuses the first missing item after a validation failure', async () => {
  form.errors = { back: 'Add a back photo', likes: 'Choose Yes or No' };
  await render();
  expect(document.activeElement).toBe(container.querySelector('#back-photo'));
});

it('lets visitors start again when their upload session expires', async () => {
  form.access = 'expired';
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'This upload session is no longer available',
  );
  expect(container.querySelector('form')).toBeNull();
  await act(async () => button('Start again').click());
  expect(form.checkAccess).toHaveBeenCalledTimes(1);
});
