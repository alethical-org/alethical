// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

type MessageHandler = (event: MessageEvent<unknown>) => void;

class SharedBroadcastChannel {
  static channels = new Map<string, Set<SharedBroadcastChannel>>();
  private readonly listeners = new Set<MessageHandler>();

  constructor(readonly name: string) {
    const peers = SharedBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    SharedBroadcastChannel.channels.set(name, peers);
  }

  addEventListener(_type: 'message', listener: MessageHandler) {
    this.listeners.add(listener);
  }

  postMessage(data: unknown) {
    for (const peer of SharedBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue;
      for (const listener of peer.listeners) listener({ data } as MessageEvent<unknown>);
    }
  }

  close() {
    SharedBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }
}

function token(sessionId: string, suffix: string) {
  const payload = globalThis
    .btoa(JSON.stringify({ session_id: sessionId }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.${suffix}`;
}

function session(sessionId: string, suffix: string) {
  return {
    access_token: token(sessionId, suffix),
    refresh_token: `refresh-${suffix}`,
    user: { id: 'person' },
  } as any;
}

afterEach(() => {
  vi.unstubAllGlobals();
  SharedBroadcastChannel.channels.clear();
  vi.resetModules();
});

describe('cancelled sessions shared by browser tabs', () => {
  it('rejects a refreshed continuation in another tab but preserves a fresh sign-in', async () => {
    vi.stubGlobal('BroadcastChannel', SharedBroadcastChannel);
    vi.resetModules();
    const tabA = await import('../providerSessionAcceptance');
    tabA.onProviderSessionRejected(() => undefined);

    vi.resetModules();
    const tabB = await import('../providerSessionAcceptance');
    const heardInTabB = vi.fn();
    tabB.onProviderSessionRejected(heardInTabB);

    const cancelled = session('cancelled', 'old');
    const refreshed = session('cancelled', 'refreshed');
    const freshSignIn = session('fresh', 'new');
    tabA.rejectProviderSession(cancelled);

    expect(heardInTabB).toHaveBeenCalledWith(tabA.providerSessionIdentity(cancelled));
    expect(tabB.isProviderSessionRejected(refreshed)).toBe(true);
    expect(tabB.isProviderSessionRejected(freshSignIn)).toBe(false);

    tabA.resetProviderSessionRejectionsForTests();
    tabB.resetProviderSessionRejectionsForTests();
  });
});
