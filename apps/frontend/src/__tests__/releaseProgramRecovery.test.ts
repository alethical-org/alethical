import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../public/index.html'), 'utf8');
const recoveryScript = html.match(
  /<script id="alethical-release-recovery">([\s\S]*?)<\/script>/,
)?.[1];

class FakeScriptElement {
  constructor(readonly src: string) {}
}

function loadRecovery(options: { storageThrows?: boolean } = {}) {
  let errorHandler: ((event: { target: unknown }) => void) | undefined;
  const reload = vi.fn();
  const stored = new Map<string, string>();
  const sessionStorage = {
    getItem: vi.fn((key: string) => {
      if (options.storageThrows) throw new Error('storage blocked');
      return stored.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.storageThrows) throw new Error('storage blocked');
      stored.set(key, value);
    }),
  };
  const windowValue = {
    addEventListener: vi.fn(
      (type: string, handler: (event: { target: unknown }) => void, capture?: boolean) => {
        if (type === 'error' && capture) errorHandler = handler;
      },
    ),
    location: {
      href: 'https://www.alethical.com/bills/HF4138',
      origin: 'https://www.alethical.com',
      reload,
    },
    sessionStorage,
  };

  expect(recoveryScript).toBeTruthy();
  runInNewContext(recoveryScript!, {
    HTMLScriptElement: FakeScriptElement,
    URL,
    window: windowValue,
  });
  expect(errorHandler).toBeTypeOf('function');

  return {
    dispatch: (target: unknown) => errorHandler!({ target }),
    reload,
    sessionStorage,
  };
}

describe('missing release program recovery', () => {
  it('reloads once when the named same-site release program file is missing', () => {
    const recovery = loadRecovery();
    const missingProgram = new FakeScriptElement(
      'https://www.alethical.com/_expo/static/js/web/index-missing.js',
    );

    recovery.dispatch(missingProgram);
    recovery.dispatch(missingProgram);

    expect(recovery.reload).toHaveBeenCalledOnce();
    expect(recovery.sessionStorage.setItem).toHaveBeenCalledOnce();
  });

  it('does not reload for a missing record, another asset, or a page crash', () => {
    const recovery = loadRecovery();

    recovery.dispatch(new FakeScriptElement('https://www.alethical.com/api/v1/bills/missing'));
    recovery.dispatch(
      new FakeScriptElement('https://cdn.example.com/_expo/static/js/web/index.js'),
    );
    recovery.dispatch({ src: 'https://www.alethical.com/_expo/static/js/web/index.js' });
    recovery.dispatch(null);

    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('does not risk a reload loop when browser-session storage is unavailable', () => {
    const recovery = loadRecovery({ storageThrows: true });

    recovery.dispatch(
      new FakeScriptElement('https://www.alethical.com/_expo/static/js/web/index-missing.js'),
    );

    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('does nothing on the successful path', () => {
    const recovery = loadRecovery();

    expect(recovery.reload).not.toHaveBeenCalled();
    expect(recovery.sessionStorage.getItem).not.toHaveBeenCalled();
    expect(recovery.sessionStorage.setItem).not.toHaveBeenCalled();
  });
});
