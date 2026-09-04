/**
 * Whether this reader has asked the browser to use less data, or is on a
 * connection slow enough that spending it on a guess would hurt.
 *
 * Speculative loading (warming a page a reader has not asked for) is a bet: it
 * costs bytes now to save a wait later, and it is only worth it when the bytes
 * are cheap. A reader on a metered phone plan, or on a 2G/3G connection, pays
 * for a guess that may be wrong, so nothing speculative runs for them.
 * Deliberate loading a reader did ask for is never gated on this.
 *
 * Three signals, any one of which is enough:
 *
 * - `navigator.connection.saveData`, the browser's own data-saver switch.
 * - `navigator.connection.effectiveType`, the browser's estimate of the
 *   connection's speed; `slow-2g`, `2g` and `3g` are all slower than the load
 *   this would add.
 * - The `prefers-reduced-data` display setting, the CSS equivalent of the same
 *   ask.
 *
 * Only Chromium browsers report the first 2 and only some browsers answer the
 * third, so an environment that reports nothing reads as not saving data. That
 * is the deliberate default: never withhold a speed improvement because a
 * browser stayed silent.
 */

/** Connection speeds slower than the warming they would have to carry. */
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g', '3g']);

interface ConnectionLike {
  saveData?: unknown;
  effectiveType?: unknown;
}

interface WindowLike {
  navigator?: { connection?: ConnectionLike } | null;
  matchMedia?: (query: string) => { matches?: unknown };
}

export function readerIsSavingData(scope: WindowLike = globalThis as WindowLike): boolean {
  try {
    const connection = scope?.navigator?.connection;
    if (connection?.saveData === true) return true;
    if (
      typeof connection?.effectiveType === 'string' &&
      SLOW_CONNECTIONS.has(connection.effectiveType)
    )
      return true;
    if (typeof scope?.matchMedia === 'function') {
      if (scope.matchMedia('(prefers-reduced-data: reduce)')?.matches === true) return true;
    }
    return false;
  } catch {
    // A browser that throws on any of these is telling us nothing, which is not
    // the same as telling us to hold back.
    return false;
  }
}
