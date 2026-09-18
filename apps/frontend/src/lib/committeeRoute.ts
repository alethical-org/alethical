/**
 * The one address helper the startup program needs from the committee pages.
 *
 * `navigation/webRoutes.ts` and `lib/share.ts` load before any screen, and each read
 * this 1 function; importing it from `lib/committeeMoneyShared.ts` put every shared
 * committee sentence and every money formatter into the download every page
 * waits on. This module imports nothing, so the address table stays light.
 * `lib/committeeMoneyShared.ts` re-exports it, so screens import it from where
 * they always did.
 */

/**
 * The registration number out of an address part, or null when it carries none.
 * The trailing run of digits is the identity; everything before it is a name part
 * a reader may have mistyped, shortened, or copied from an old name. A committee
 * with a negative internal number has no addressable form here on purpose — those
 * exist only as targets of someone else's spending and are absent from the
 * register (phase 2 scope).
 */
export function registrationNumberFromSlug(segment: string | null | undefined): string | null {
  if (!segment) return null;
  const match = /(\d+)$/.exec(segment);
  return match ? match[1] : null;
}
