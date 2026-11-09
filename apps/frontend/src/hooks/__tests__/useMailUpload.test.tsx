// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  session: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  submit: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../../data/mailUpload', async (load) => ({
  ...(await load<typeof import('../../data/mailUpload')>()),
  getMailUploadSession: calls.session,
  createMailSubmission: calls.create,
  uploadMailImage: calls.upload,
  submitMailSubmission: calls.submit,
  getMailSubmission: calls.get,
}));
import { MailUploadError, MAX_MAIL_IMAGE_BYTES, type MailSubmission } from '../../data/mailUpload';
import { useMailUpload } from '../useMailUpload';

let root: Root;
let container: HTMLDivElement;
let hook: ReturnType<typeof useMailUpload>;
const access = {
  token: 'demo-session',
  expires_at: '2099-01-01T00:00:00Z',
  supported_content_types: ['image/jpeg'],
};
const receipt = { sha256: 'a'.repeat(64), content_type: 'image/jpeg', bytes: 5 };
const draft: MailSubmission = {
  id: 'test-id',
  status: 'draft',
  front: null,
  back: null,
  likes_ad: null,
  comment: null,
};
const file = (name = 'front.jpg') => new File(['photo'], name, { type: 'image/jpeg' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Probe() {
  hook = useMailUpload();
  return null;
}
async function mount() {
  await act(async () => root.render(createElement(Probe)));
}
async function addBoth() {
  await act(async () => {
    await hook.upload('front', file());
    await hook.upload('back', file('back.jpg'));
  });
  await act(async () => {
    hook.setLikes(true);
    hook.setComment('Original comment');
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.values(calls).forEach((mock) => mock.mockReset());
  history.replaceState(null, '', '/mail-upload');
  calls.session.mockResolvedValue(access);
  calls.create.mockResolvedValue(draft);
  calls.upload.mockImplementation(async (_token, _id, side, photo) => ({
    ...draft,
    [side]: { ...receipt, bytes: photo.size },
  }));
  calls.submit.mockResolvedValue({ ...draft, status: 'saved' });
  calls.get.mockResolvedValue(draft);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('mail photo confirmation', () => {
  it('shows confirmation only after a server receipt for those bytes', async () => {
    await mount();
    const pending = deferred<MailSubmission>();
    calls.upload.mockReturnValueOnce(pending.promise);
    const photo = file();
    let operation!: Promise<void>;
    await act(async () => {
      operation = hook.upload('front', photo);
    });
    expect(hook.photos.front.busy).toBe(true);
    expect(hook.photos.front.receipt).toBeUndefined();
    expect(hook.photos.front.file).toBe(photo);
    await act(async () => {
      pending.resolve({ ...draft, front: receipt });
      await operation;
    });
    expect(hook.photos.front).toMatchObject({ busy: false, receipt, confirmedFile: photo });
    expect(hook.photos.front.file).toBeUndefined();
    expect(calls.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a response without a matching receipt', async () => {
    await mount();
    calls.upload.mockResolvedValueOnce({ ...draft, front: { ...receipt, bytes: 99 } });
    await act(async () => {
      await hook.upload('front', file());
    });
    expect(hook.photos.front.receipt).toBeUndefined();
    expect(hook.photos.front.error).toBeTruthy();
  });

  it('keeps a confirmed photo on replacement failure and prevents finalizing the pending new photo', async () => {
    await mount();
    await addBoth();
    const old = hook.photos.front.confirmedFile;
    const replacement = file('replacement.jpg');
    calls.upload.mockRejectedValueOnce(new MailUploadError(503, 'Unavailable'));
    await act(async () => {
      await hook.upload('front', replacement);
    });
    expect(hook.photos.front.confirmedFile).toBe(old);
    expect(hook.photos.front.file).toBe(replacement);
    await act(async () => {
      await hook.submit();
    });
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', () => new File([], 'empty.jpg', { type: 'image/jpeg' })],
    [
      'oversized',
      () =>
        new File([new Uint8Array(MAX_MAIL_IMAGE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' }),
    ],
  ])(
    'prevents saving an old photo while a rejected %s replacement is shown',
    async (_label, makeFile) => {
      await mount();
      await addBoth();
      const confirmed = hook.photos.front.confirmedFile;
      calls.upload.mockClear();
      await act(async () => {
        await hook.upload('front', makeFile());
      });
      expect(hook.photos.front.confirmedFile).toBe(confirmed);
      expect(hook.photos.front.error).toBeTruthy();
      expect(calls.upload).not.toHaveBeenCalled();
      await act(async () => {
        await hook.submit();
      });
      expect(calls.submit).not.toHaveBeenCalled();
    },
  );

  it('keeps unsupported photo errors separate from a confirmed photo', async () => {
    await mount();
    await addBoth();
    calls.upload.mockRejectedValueOnce(new MailUploadError(422, 'Unsupported'));
    await act(async () => {
      await hook.upload('back', new File(['bad'], 'bad.svg', { type: 'image/svg+xml' }));
    });
    expect(hook.photos.back.error).toBeTruthy();
    await act(async () => {
      await hook.submit();
    });
    expect(calls.submit).not.toHaveBeenCalled();
  });
});

describe('retry-safe mail submission', () => {
  it('does not send twice on a double tap, and a retry retains the ID and original payload', async () => {
    await mount();
    await addBoth();
    const pending = deferred<MailSubmission>();
    calls.submit.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>;
    await act(async () => {
      first = hook.submit();
      await hook.submit();
    });
    expect(calls.submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new MailUploadError(0, 'Uncertain'));
      await first;
    });
    expect(hook.status).toBe('retry');
    await act(async () => {
      hook.setLikes(false);
      hook.setComment('Changed after uncertainty');
    });
    await act(async () => {
      await hook.submit();
    });
    expect(calls.submit).toHaveBeenCalledTimes(2);
    expect(calls.submit.mock.calls[1].slice(0, 3)).toEqual(calls.submit.mock.calls[0].slice(0, 3));
    expect(calls.submit.mock.calls[1][2]).toEqual({ likes_ad: true, comment: 'Original comment' });
    expect(hook.status).toBe('saved');
  });

  it('recovers an ambiguous save from GET without submitting again', async () => {
    await mount();
    await addBoth();
    calls.submit.mockRejectedValueOnce(new MailUploadError(0, 'Uncertain'));
    calls.get.mockResolvedValueOnce({ ...draft, status: 'saved' });
    await act(async () => {
      await hook.submit();
    });
    expect(hook.status).toBe('saved');
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(calls.get.mock.calls[0].slice(0, 2)).toEqual(calls.submit.mock.calls[0].slice(0, 2));
  });

  it('allocates a different ID for another mailer after saving', async () => {
    await mount();
    await addBoth();
    await act(async () => {
      await hook.submit();
      hook.reset();
    });
    expect(hook.status).toBe('editing');
    expect(hook.photos.front.receipt).toBeUndefined();
    await addBoth();
    expect(calls.create.mock.calls[1][1]).not.toBe(calls.create.mock.calls[0][1]);
  });
});

describe('asynchronous access boundaries', () => {
  it('does not start a photo upload when draft creation finishes after unmount', async () => {
    await mount();
    const pending = deferred<MailSubmission>();
    calls.create.mockReturnValueOnce(pending.promise);
    let operation!: Promise<void>;
    await act(async () => {
      operation = hook.upload('front', file());
    });
    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve(draft);
      await operation;
    });
    expect(calls.upload).not.toHaveBeenCalled();
  });

  it('does not let an older access response replace the current session', async () => {
    const old = deferred<typeof access>();
    calls.session.mockReturnValueOnce(old.promise);
    await mount();
    calls.session.mockResolvedValueOnce({ ...access, token: 'new-session' });
    await act(async () => {
      await hook.checkAccess();
    });
    await act(async () => {
      old.resolve(access);
    });
    await act(async () => {
      await hook.upload('front', file());
    });
    expect(calls.create.mock.calls[0][0]).toBe('new-session');
  });

  it('clears old receipts when access changes and ignores an old in-flight photo', async () => {
    await mount();
    await addBoth();
    const pending = deferred<MailSubmission>();
    calls.upload.mockReturnValueOnce(pending.promise);
    let operation!: Promise<void>;
    await act(async () => {
      operation = hook.upload('front', file('replacement.jpg'));
    });
    calls.session.mockResolvedValueOnce({ ...access, token: 'new-session' });
    await act(async () => {
      await hook.checkAccess();
    });
    await act(async () => {
      pending.resolve({ ...draft, front: receipt });
      await operation;
    });
    expect(hook.photos.front.receipt).toBeUndefined();
    expect(hook.photos.back.receipt).toBeUndefined();
    expect(hook.status).toBe('editing');
    await act(async () => {
      await hook.submit();
    });
    expect(calls.submit).not.toHaveBeenCalled();
  });
});

it('reauthenticates when a new invitation opens through same-page hash navigation', async () => {
  await mount();
  await addBoth();
  calls.session.mockResolvedValueOnce({ ...access, token: 'new-invitation-session' });
  await act(async () => {
    history.replaceState(null, '', '/mail-upload#invite=new-invitation');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(calls.session).toHaveBeenCalledTimes(2);
  expect(hook.photos.front.receipt).toBeUndefined();
  await act(async () => {
    await hook.upload('front', file());
  });
  expect(calls.create.mock.calls[1][0]).toBe('new-invitation-session');
});

it('does not reconcile an uncertain save after unmount', async () => {
  await mount();
  await addBoth();
  const pending = deferred<MailSubmission>();
  calls.submit.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = hook.submit();
  });
  const signal = calls.submit.mock.calls[0][3].signal as AbortSignal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.reject(new MailUploadError(0, 'Uncertain'));
    await operation;
  });
  expect(calls.get).not.toHaveBeenCalled();
});

it('ignores saved recovery from an earlier session', async () => {
  await mount();
  await addBoth();
  const pending = deferred<MailSubmission>();
  calls.submit.mockRejectedValueOnce(new MailUploadError(0, 'Uncertain'));
  calls.get.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = hook.submit();
  });
  calls.session.mockResolvedValueOnce({ ...access, token: 'new-session' });
  await act(async () => {
    await hook.checkAccess();
  });
  await act(async () => {
    pending.resolve({ ...draft, status: 'saved' });
    await operation;
  });
  expect(hook.status).toBe('editing');
  expect(hook.photos.front.receipt).toBeUndefined();
});

it.each([
  ['Open your invitation link to continue', 'missing'],
  ['This demo link is no longer available', 'expired'],
])('distinguishes missing access from expired access: %s', async (detail, expected) => {
  calls.session.mockRejectedValueOnce(new MailUploadError(401, detail));
  await mount();
  expect(hook.access).toBe(expected);
});
