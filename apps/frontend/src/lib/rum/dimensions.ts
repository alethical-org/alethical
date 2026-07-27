// Derives the coarse dimensions attached to a RUM event. All signals here are
// non-identifying by construction: device class from the platform/viewport, a
// timezone string for rough geography, and a cold/warm marker — no PII, no
// precise location, no IP.

import { Dimensions, Platform } from 'react-native';

import { CacheStatus, DeviceClass } from './types';

// Cold = the first measured read of this app session (nothing warmed yet); warm
// = every read after it. Module-level so it persists for the session and flips
// exactly once, on the first captured read.
let coldConsumed = false;

export function nextColdFlag(): boolean {
  if (coldConsumed) {
    return false;
  }
  coldConsumed = true;
  return true;
}

// Test-only reset so the cold/warm flag doesn't leak across cases.
export function _resetColdFlagForTests(): void {
  coldConsumed = false;
}

export function deviceClass(): DeviceClass {
  // Native app is always a phone/tablet — treat as mobile. On web, split by
  // viewport width at the same 768px breakpoint the layout uses.
  if (Platform.OS !== 'web') {
    return 'mobile';
  }
  const { width } = Dimensions.get('window');
  return width < 768 ? 'mobile' : 'desktop';
}

export function coarseGeo(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Map a response's CDN cache header to hit/miss/unknown. Prefers Cloudflare's
// cf-cache-status; falls back to a positive Age header. Cross-origin these
// headers are only readable when the API exposes them (Access-Control-Expose-
// Headers) — otherwise this degrades to "unknown", never a wrong guess.
export function cacheStatusFromResponse(response: Response): CacheStatus {
  const cf = response.headers.get('cf-cache-status');
  if (cf) {
    const value = cf.toUpperCase();
    // HIT and REVALIDATED were both served from the edge cache.
    return value === 'HIT' || value === 'REVALIDATED' ? 'hit' : 'miss';
  }
  const age = response.headers.get('age');
  if (age !== null) {
    const seconds = Number(age);
    if (Number.isFinite(seconds)) {
      return seconds > 0 ? 'hit' : 'miss';
    }
  }
  return 'unknown';
}

// Best-effort time-to-first-byte from the Web Performance API (web only). Native
// RN has no PerformanceResourceTiming, so this returns null there. Matches the
// resource entry by exact URL; returns null when unavailable or non-positive.
export function ttfbFromPerformance(url: string): number | null {
  if (Platform.OS !== 'web') {
    return null;
  }
  try {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf?.getEntriesByType) {
      return null;
    }
    const entries = perf.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.name === url) {
        const ttfb = entry.responseStart - entry.requestStart;
        return ttfb > 0 ? Math.round(ttfb) : null;
      }
    }
  } catch {
    // Performance API unavailable or blocked — fall through to null.
  }
  return null;
}
