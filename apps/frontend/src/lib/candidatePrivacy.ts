// Remain independent of the lazy candidate screens and their API client.
const resets = new Set<() => void>();

export function registerCandidatePrivacyReset(reset: () => void) {
  resets.add(reset);
  return () => resets.delete(reset);
}

export function resetCandidatePrivacy() {
  for (const reset of resets) reset();
}
