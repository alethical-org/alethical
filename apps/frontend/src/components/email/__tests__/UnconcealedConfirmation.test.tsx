// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailPreferences } from '../../../data/emailSubscriptions';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('../../../data/emailSubscriptions', () => ({
  readEmailPreferences: api.read,
  saveEmailPreferences: api.save,
}));
vi.mock('../../auth/SignInContainer', async () => {
  const { View } = await import('react-native');
  return {
    SignInContainer: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <View>{children}</View> : null,
  };
});
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null }));

import { UnconcealedConfirmation } from '../UnconcealedConfirmation';

let root: Root;
let host: HTMLElement;
let saved: ReturnType<typeof vi.fn<(preferences: EmailPreferences) => void>>;
const starting = {
  account_id: 'account-1',
  email: 'reader@example.com',
  research: null,
  features: true,
  version: 5,
};

function action(label: string) {
  const result = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((node) =>
    node.textContent?.includes(label),
  );
  expect(result).toBeDefined();
  return result!;
}
async function mount() {
  await act(async () => {
    root.render(
      <UnconcealedConfirmation
        open
        accessToken="token-1"
        accountId="account-1"
        onClose={() => {}}
        onSaved={saved}
        onBack={() => {}}
        onPreferences={() => {}}
      />,
    );
    await Promise.resolve();
  });
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  saved = vi.fn();
  api.read.mockReset().mockResolvedValue(starting);
  api.save.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Unconcealed confirmation', () => {
  it('keeps an existing features choice and writes only after Subscribe', async () => {
    api.save.mockResolvedValue({ ...starting, research: true, version: 6 });
    await mount();
    expect(api.save).not.toHaveBeenCalled();
    expect(host.textContent).toContain('reader@example.com');
    await act(async () => {
      action('Subscribe to Unconcealed').click();
      await Promise.resolve();
    });
    expect(api.save).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({
        research: true,
        expected_version: 5,
        expected_account_id: 'account-1',
        expected_email: 'reader@example.com',
        source: 'confirmation',
      }),
    );
    expect(api.save.mock.calls[0][1]).not.toHaveProperty('features');
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ research: true, features: true }));
  });

  it('shows an uncertain result and retries the exact same request', async () => {
    api.save
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ ...starting, research: true, version: 6 });
    await mount();
    await act(async () => {
      action('Subscribe to Unconcealed').click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('couldn’t confirm');
    expect(saved).not.toHaveBeenCalled();
    await act(async () => {
      action('Try again').click();
      await Promise.resolve();
    });
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1][1]).toEqual(api.save.mock.calls[0][1]);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh press if an old retry returns a newer unsubscribe', async () => {
    api.save
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ ...starting, research: false, version: 7 });
    await mount();
    await act(async () => {
      action('Subscribe to Unconcealed').click();
      await Promise.resolve();
    });
    await act(async () => {
      action('Try again').click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Your email choices changed');
    expect(host.textContent).toContain('Subscribe to Unconcealed');
    expect(saved).not.toHaveBeenCalled();
    api.save.mockResolvedValueOnce({ ...starting, research: true, version: 8 });
    await act(async () => {
      action('Subscribe to Unconcealed').click();
      await Promise.resolve();
    });
    expect(api.save.mock.calls[2][1].expected_version).toBe(7);
    expect(api.save.mock.calls[2][1].idempotency_key).not.toBe(
      api.save.mock.calls[1][1].idempotency_key,
    );
  });
});
