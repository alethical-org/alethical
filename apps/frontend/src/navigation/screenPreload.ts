import { screenChunks, type ScreenChunkName, type ScreenLoader } from './screenChunks';
import { stateFromPathname } from './webRoutes';

/** Route names that are a second address for one screen, so both fetch one piece. */
const SHARED_SCREEN: Record<string, ScreenChunkName> = { Guide: 'Research' };

/** The screen an address lands on, read from the router itself. */
export function screenNameForPath(pathname: string): string | null {
  const state = stateFromPathname(pathname);
  const route = state.routes[state.index ?? state.routes.length - 1];
  if (!route) {
    return null;
  }
  if (route.name !== 'Tabs') {
    return route.name;
  }
  const tabs = route.state;
  return tabs?.routes[tabs.index ?? 0]?.name ?? null;
}

export function screenLoaderForPath(pathname: string): ScreenLoader | null {
  const name = screenNameForPath(pathname);
  if (!name) {
    return null;
  }
  const key = (SHARED_SCREEN[name] ?? name) as ScreenChunkName;
  return screenChunks[key] ?? null;
}

/**
 * Fetch the piece this address needs before the app starts drawing.
 *
 * React empties the app's mount point the first time it draws, and the server's
 * readable text sits inside that mount point. Waiting here keeps that text up
 * until the real screen is ready to take its place, instead of replacing it with
 * an empty box while the screen's file is still on the way.
 *
 * It never blocks the app: a piece that fails or takes too long lets the app
 * start anyway, and the same failure then reaches the screen's own recovery.
 */
export function preloadScreenForPath(pathname: string, timeoutMs = 4000): Promise<void> {
  const load = screenLoaderForPath(pathname);
  if (!load) {
    return Promise.resolve();
  }
  return Promise.race([
    load().then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/**
 * Start downloading the screen an address needs, before anyone goes there.
 *
 * Call it when a reader shows they are heading somewhere — a hover, a finger
 * down on a row — so the screen file is already in the browser when the click
 * lands. It never throws and never blocks: a failure here is a download that
 * will simply happen again at navigation, where it has its own recovery.
 * Downloads are remembered by the loader, so calling it twice costs 1 request.
 */
export function prefetchScreenForPath(pathname: string): void {
  const load = screenLoaderForPath(pathname);
  if (!load) {
    return;
  }
  void load().catch(() => undefined);
}
