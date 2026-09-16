import { ComponentType, Suspense, lazy, useState } from 'react';

import { requestReleaseReload } from './releaseReload';

/** A part of the app that arrives in its own downloaded piece. */
export type OnDemandLoader = () => Promise<{ default: ComponentType<any> }>;

/**
 * Pieces already in the browser, so a draw that needs one needs no waiting.
 *
 * React's `lazy` always waits once, even for a piece the browser already holds:
 * it can only read the piece through a promise, and a promise is answered after
 * the current draw. That first wait is not free. React refuses to reveal
 * anything held back behind a waiting marker for 300 ms after the marker
 * appears, so that a slow piece cannot flash an empty box and vanish. Every page
 * paid that 300 ms before its screen could ask for a single record, because the
 * screen's piece is fetched before React starts (`navigation/screenPreload.ts`)
 * and then goes through `lazy` anyway. Measured 16 September 2026 at 296 ms on a
 * local release build and 265 ms live, on every address
 * (https://github.com/alethical-org/alethical/issues/2222).
 *
 * So a piece that has already arrived is remembered here and drawn straight,
 * with no waiting marker and nothing for React to hold back.
 */
const alreadyLoaded = new Map<OnDemandLoader, ComponentType<any>>();

/**
 * Fetch a piece and remember it, so the draw that needs it does not wait.
 *
 * Anything that fetches a piece ahead of time goes through this rather than
 * calling the loader itself; calling the loader directly downloads the piece and
 * leaves the draw waiting for it all the same.
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
 * The fallback is nothing at all. A screen's piece is already on its way before
 * React draws anything (`navigation/screenPreload.ts`), so the server-written
 * text stays on screen until the real screen can replace it; a spinner in that
 * slot would take readable words away and give back less. The sign-in surfaces
 * draw nothing until somebody opens them, so nothing is missing there either.
 */
export function loadOnDemand(load: OnDemandLoader): ComponentType<any> {
  const Screen = lazy(() =>
    loadAndRemember(load).catch((error) => {
      // A missing piece almost always means a release replaced it while this tab
      // was open. One reload puts the tab on the current release.
      requestReleaseReload();
      throw error;
    }),
  );

  return function LoadedOnDemand(props: any) {
    // Read once, when this part first draws. A part that starts out waiting
    // keeps waiting for the rest of its life on screen: swapping the two ways of
    // drawing it halfway through would throw the screen away and build it again.
    const [Ready] = useState(() => alreadyLoaded.get(load));
    if (Ready) {
      return <Ready {...props} />;
    }
    return (
      <Suspense fallback={null}>
        <Screen {...props} />
      </Suspense>
    );
  };
}
