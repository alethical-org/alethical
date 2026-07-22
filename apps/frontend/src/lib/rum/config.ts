// RUM collection is OFF by default and only turns on when the maintainer flips
// EXPO_PUBLIC_RUM_ENABLED to "true" (#516). Until then nothing is captured or
// sent, so no real-user data is collected. The sample rate bounds write volume
// so enabled collection can't flood the events table.

export function isRumEnabled(): boolean {
  return process.env.EXPO_PUBLIC_RUM_ENABLED === 'true';
}

// Fraction of read interactions to actually send, in [0, 1]. Defaults to 0.1
// (10%) — enough signal for percentiles, small enough to stay cheap. An unset
// or out-of-range value falls back to the default.
export function rumSampleRate(): number {
  const raw = process.env.EXPO_PUBLIC_RUM_SAMPLE_RATE;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0.1;
  }
  return parsed;
}
