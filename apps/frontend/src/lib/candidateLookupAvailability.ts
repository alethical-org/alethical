/** Private development review only. Production stays off even if the flag is set. */
export function candidatePreviewEnabled(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW === 'true'
  );
}
