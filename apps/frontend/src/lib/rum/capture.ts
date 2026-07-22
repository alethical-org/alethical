// The "capture" concern of RUM (#516): turn a completed read request into an
// anonymous RumEvent, then hand it to the send layer. Kept separate from send
// so the sink can be swapped without touching instrumentation.

import { isRumEnabled } from './config';
import {
  cacheStatusFromResponse,
  coarseGeo,
  deviceClass,
  nextColdFlag,
  ttfbFromPerformance,
} from './dimensions';
import { sendRumEvent } from './send';
import { RumInteraction } from './types';

export interface CapturedRead {
  // Absolute request URL — used to look up the matching Web Performance entry.
  url: string;
  // The fetch Response, read for cache-status headers only (not its body).
  response: Response;
  // Client-measured total duration from request start to response body parsed.
  durationMs: number;
}

// Record one read-surface interaction. Gated on the enable flag so there is zero
// overhead (and the cold/warm flag never advances) when collection is off. Never
// throws — instrumentation must not break the data fetch it measures.
export function captureRead(interaction: RumInteraction, read: CapturedRead): void {
  if (!isRumEnabled()) {
    return;
  }
  try {
    sendRumEvent({
      interaction,
      duration_ms: Math.max(0, Math.round(read.durationMs)),
      ttfb_ms: ttfbFromPerformance(read.url),
      cache_status: cacheStatusFromResponse(read.response),
      device_class: deviceClass(),
      cold: nextColdFlag(),
      coarse_geo: coarseGeo(),
    });
  } catch {
    // Swallow: a monitoring failure must never surface to the user.
  }
}
