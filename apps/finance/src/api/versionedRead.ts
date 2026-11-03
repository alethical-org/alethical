import { useCallback, useEffect, useRef, useState } from 'react';
import { useFinanceSession } from '../auth/session';
import { useRead, type Read } from './read';

export const RECORDS_CHANGED =
  'These records changed. Reload the list. Previous results are shown.';

/** One source version per filtered list. A refused page never replaces or joins
 * its previous results; retry starts at page 1 without a token or cached pages. */
export function useVersionedRead<T>(
  path: string | null,
  {
    page,
    onRestart,
    acceptData,
    refresh = 0,
  }: {
    page: number;
    onRestart: () => void;
    acceptData?: (data: T) => boolean;
    refresh?: number;
  },
): Read<T> & { listKey: string } {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const [cycle, setCycle] = useState(0);
  const restart = useRef(onRestart);
  restart.current = onRestart;
  const parsed = path ? new URL(path, 'https://list.invalid/') : null;
  parsed?.searchParams.delete('offset');
  parsed?.searchParams.delete('page');
  const scope = `${apiBaseUrl}|${accessToken}|${parsed?.pathname}${parsed?.search}|${refresh}|${cycle}`;
  const [pin, setPin] = useState<{
    scope: string;
    path: string;
    page: number;
    version: string | null;
  } | null>(null);
  const ownPin = pin?.scope === scope ? pin : null;
  const missingVersion = !!ownPin && ownPin.page !== page && !ownPin.version;
  const requested = path ? new URL(path, 'https://list.invalid/') : null;
  if (ownPin?.version && ownPin.path !== path)
    requested?.searchParams.set('version', ownPin.version);
  const pinnedPath = missingVersion
    ? ownPin.path
    : requested
      ? `${requested.pathname.slice(1)}${requested.search}`
      : null;
  const read = useRead<T>(pinnedPath, {
    keepPrevious: true,
    acceptData,
    revision: `${refresh}|${cycle}`,
  });
  useEffect(() => {
    if (!path || !read.data || read.loading || read.updating || read.failed || missingVersion)
      return;
    const value = (read.data as { version?: unknown }).version;
    const version = typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : null;
    if (!ownPin || (ownPin.path === path && ownPin.version !== version))
      setPin({ scope, path, page, version });
  }, [
    read.data,
    read.loading,
    read.updating,
    read.failed,
    missingVersion,
    ownPin,
    scope,
    path,
    page,
  ]);
  const retry = useCallback(() => {
    if (read.changed || missingVersion) {
      restart.current();
      setCycle((value) => value + 1);
    } else read.retry();
  }, [read.changed, read.retry, missingVersion]);
  return { ...read, failed: read.failed || missingVersion, retry, listKey: scope };
}
