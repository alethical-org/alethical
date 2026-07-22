// The "send" concern of RUM, kept separate from capture so the sink is
// swappable (#516). Today it POSTs to our own beacon endpoint (/api/v1/rum). To
// route to a hosted RUM tool instead (PostHog / Sentry / Cloudflare Web
// Analytics), replace the body of `deliver` — the captured RumEvent shape and
// the capture layer stay untouched.
//
// This layer owns the gate (EXPO_PUBLIC_RUM_ENABLED) and the client-side
// sampling, so nothing leaves the device unless collection is explicitly on.

import { isRumEnabled, rumSampleRate } from './config';
import { RumEvent } from './types';

function beaconUrl(): string | null {
  const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  return origin ? `${origin}/api/v1/rum` : null;
}

function deliver(url: string, event: RumEvent): void {
  const body = JSON.stringify(event);
  // Prefer sendBeacon on web: fire-and-forget, survives navigation, never
  // blocks the interaction being measured.
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav?.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      if (nav.sendBeacon(url, blob)) {
        return;
      }
    } catch {
      // Fall through to fetch.
    }
  }
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Beacons are best-effort; a dropped one must never surface to the user.
  });
}

export function sendRumEvent(event: RumEvent): void {
  if (!isRumEnabled()) {
    return;
  }
  // Client-side sampling: only a fraction of events are sent, bounding write
  // volume so collection can't flood the prod DB.
  if (Math.random() >= rumSampleRate()) {
    return;
  }
  const url = beaconUrl();
  if (!url) {
    return;
  }
  deliver(url, event);
}
