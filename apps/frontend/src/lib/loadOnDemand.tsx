import { ComponentType, Suspense, lazy } from 'react';

import { requestReleaseReload } from './releaseReload';

/** A part of the app that arrives in its own downloaded piece. */
export type OnDemandLoader = () => Promise<{ default: ComponentType<any> }>;

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
    load().catch((error) => {
      // A missing piece almost always means a release replaced it while this tab
      // was open. One reload puts the tab on the current release.
      requestReleaseReload();
      throw error;
    }),
  );

  return function LoadedOnDemand(props: any) {
    return (
      <Suspense fallback={null}>
        <Screen {...props} />
      </Suspense>
    );
  };
}
