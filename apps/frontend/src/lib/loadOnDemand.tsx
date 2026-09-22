import { ComponentType, useEffect, useState } from 'react';

import { requestReleaseReload } from './releaseReload';

/** A part of the app that arrives in its own downloaded piece. */
export type OnDemandLoader = () => Promise<{ default: ComponentType<any> }>;

/**
 * Pieces already in the browser, so a draw that needs one draws it in its very
 * first frame rather than a frame or 2 later.
 *
 * Anything that fetches a piece ahead of time goes through `loadAndRemember`
 * rather than calling the loader itself. Calling the loader directly downloads
 * the piece and leaves nothing behind, so the part that needs it asks for the
 * piece again and draws a frame late.
 */
const alreadyLoaded = new Map<OnDemandLoader, ComponentType<any>>();

/**
 * Fetch a piece and remember it, so the draw that needs it does not wait.
 */
export function loadAndRemember(load: OnDemandLoader): Promise<{ default: ComponentType<any> }> {
  return load().then((piece) => {
    alreadyLoaded.set(load, piece.default);
    return piece;
  });
}

/**
 * A part of the app that arrives in its own downloaded piece.
 *
 * The part fetches its own piece and draws it the moment it arrives, with an
 * empty slot in the meantime. React's `lazy` is deliberately not used, and the
 * reason is a fixed wait rather than a matter of taste: `lazy` can only read a
 * piece through a promise, so the first draw always puts a waiting marker in
 * the slot, and React then refuses to reveal whatever replaces that marker
 * until 300 ms have passed (`FALLBACK_THROTTLE_MS`), so that a slow piece
 * cannot flash an empty box and vanish. Nothing here can flash, because the
 * slot holds nothing at all until the piece arrives, so that 300 ms is pure
 * waiting.
 *
 * It is the whole reason a click cost more than arriving at the same address
 * fresh. A screen this tab has not drawn before is fetched, drawn into the
 * marker, and then held back, and the record requests the screen makes when it
 * draws are held back with it. Measured against production on 22 September
 * 2026, 6 journeys, 3 clicks each: 307 to 356 ms from the click to the records
 * being on screen, with a stretch of 263 to 309 ms in the middle of it in which
 * the browser fetched nothing at all
 * (https://github.com/alethical-org/alethical/issues/1988).
 *
 * `components/campaignMoney/MoneyDetailsOnDemand.tsx` draws its chart this same
 * way, for the same reason.
 */
export function loadOnDemand(load: OnDemandLoader): ComponentType<any> {
  return function LoadedOnDemand(props: any) {
    // Read once, when this part first draws, so a piece already in the browser
    // is drawn in the first frame with nothing fetched and nothing waited on.
    const [Ready, setReady] = useState(() => alreadyLoaded.get(load));
    const [missing, setMissing] = useState<unknown>(null);

    useEffect(() => {
      if (Ready) return;
      let stillDrawn = true;
      loadAndRemember(load).then(
        (piece) => {
          if (stillDrawn) setReady(() => piece.default);
        },
        (error: unknown) => {
          // A missing piece almost always means a release replaced it while
          // this tab was open. One reload puts the tab on the current release.
          requestReleaseReload();
          if (stillDrawn) setMissing(error ?? new Error('a piece of the app is missing'));
        },
      );
      return () => {
        stillDrawn = false;
      };
    }, [Ready]);

    if (missing) {
      // Thrown while drawing, so the app's error screen catches it exactly as it
      // caught a missing piece before.
      throw missing;
    }

    return Ready ? <Ready {...props} /> : null;
  };
}
