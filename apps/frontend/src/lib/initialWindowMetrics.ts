/**
 * What the safe-area provider knows about the window before it has measured it.
 *
 * On the web the provider is given nothing to start from, so its first draw puts
 * up an empty full-height box and holds every screen back until a measurement
 * lands a frame later (`react-native-safe-area-context`'s `SafeAreaProvider`
 * draws its children only once `insets` is set). That empty frame was on screen
 * between the server's text and the app on every address: measured 17 Sep 2026
 * on the live site as a blank white paint about 40 ms long. A browser window has
 * no notch to measure, so the insets are known to be 0 before anything draws,
 * and the frame is the document's own size. The provider still measures
 * afterwards and corrects itself where a phone browser reports a real inset.
 *
 * Kept free of any React Native import so a plain Node test can read it.
 */
export interface InitialWindowMetrics {
  insets: { top: number; right: number; bottom: number; left: number };
  frame: { x: number; y: number; width: number; height: number };
}

export function initialWebWindowMetrics(): InitialWindowMetrics | undefined {
  if (typeof document === 'undefined' || !document.documentElement) return undefined;
  return {
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    frame: {
      x: 0,
      y: 0,
      width: document.documentElement.offsetWidth,
      height: document.documentElement.offsetHeight,
    },
  };
}
