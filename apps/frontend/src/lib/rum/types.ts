// Shared types for real-user monitoring (RUM) of read-surface latency (#516).
// The event is deliberately anonymous — timing + coarse dimensions only, never
// PII. Its shape mirrors the backend RumEventRequest (alethical/api/schemas.py).

// Which instrumented read interaction was measured. Bills-list load and
// filter-chip apply first (#516); add more surfaces here as they're wired up.
export type RumInteraction = 'bills_list' | 'bills_filter';

export type CacheStatus = 'hit' | 'miss' | 'unknown';
export type DeviceClass = 'mobile' | 'desktop';

export interface RumEvent {
  interaction: RumInteraction;
  // Total client-measured request duration in milliseconds.
  duration_ms: number;
  // Time-to-first-byte in ms when the platform exposes it (web only), else null.
  ttfb_ms: number | null;
  cache_status: CacheStatus;
  device_class: DeviceClass;
  // First measured read of this app session (cold) vs a later one (warm).
  cold: boolean;
  // Coarse geo: the visitor's IANA timezone (e.g. "America/Chicago"). Rough
  // region only — never precise location, never IP.
  coarse_geo: string | null;
}
