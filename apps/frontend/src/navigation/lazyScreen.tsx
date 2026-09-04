import { ComponentType, Suspense, lazy } from 'react';

import { requestReleaseReload } from '../lib/releaseReload';
import type { ScreenLoader } from './screenChunks';

/**
 * A screen that arrives in its own downloaded piece.
 *
 * The fallback is nothing at all. On a first visit the piece is already on its
 * way before React draws anything (`screenPreload.ts`), so the server-written
 * text stays on screen until the real screen can replace it. A spinner in that
 * slot would take readable words away and give back less.
 */
export function lazyScreen(load: ScreenLoader): ComponentType<any> {
  const Screen = lazy(() =>
    load().catch((error) => {
      // A missing piece almost always means a release replaced it while this tab
      // was open. One reload puts the tab on the current release.
      requestReleaseReload();
      throw error;
    }),
  );

  return function LazyScreen(props: any) {
    return (
      <Suspense fallback={null}>
        <Screen {...props} />
      </Suspense>
    );
  };
}
