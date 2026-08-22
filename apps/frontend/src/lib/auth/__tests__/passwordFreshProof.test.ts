import { describe, expect, it, vi } from 'vitest';

import { savePasswordWithFreshProof } from '../passwordFreshProof';

describe('fresh proof during a password save', () => {
  it('accepts a password that already works', async () => {
    const updateUser = vi.fn(async () => ({
      error: { code: 'same_password', status: 422 },
    }));
    const reauthenticate = vi.fn();

    const result = await savePasswordWithFreshProof(
      { updateUser, reauthenticate },
      'password',
      undefined,
      'marissa@example.com',
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it('sends the code once, then retries the same password with that code', async () => {
    const updateUser = vi
      .fn()
      .mockResolvedValueOnce({
        error: { code: 'reauthentication_needed', status: 400, message: 'provider wording' },
      })
      .mockResolvedValueOnce({ error: null });
    const reauthenticate = vi.fn().mockResolvedValue({ error: null });
    const auth = { updateUser, reauthenticate };

    const first = await savePasswordWithFreshProof(
      auth,
      'a long password with spaces',
      undefined,
      'marissa@example.com',
    );

    expect(first).toEqual({
      ok: false,
      error: {
        kind: 'fresh-proof',
        message: 'Enter the newest code for marissa@example.com to confirm it’s you',
      },
    });
    expect(updateUser).toHaveBeenNthCalledWith(1, {
      password: 'a long password with spaces',
      nonce: undefined,
    });
    expect(reauthenticate).toHaveBeenCalledOnce();

    const second = await savePasswordWithFreshProof(
      auth,
      'a long password with spaces',
      '123456',
      'marissa@example.com',
    );

    expect(second).toEqual({ ok: true, data: undefined });
    expect(updateUser).toHaveBeenNthCalledWith(2, {
      password: 'a long password with spaces',
      nonce: '123456',
    });
    expect(reauthenticate).toHaveBeenCalledOnce();
  });
});
