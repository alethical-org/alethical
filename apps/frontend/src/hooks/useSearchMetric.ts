import { useEffect, useRef } from 'react';

import { recordSiteMetricEvent } from '../lib/siteMetricEvents';
import type { SiteMetricEventName } from '../lib/traffic';

type SearchMetric = {
  event: SiteMetricEventName;
  query: string;
  context: string;
  page?: number;
  isSuccess: boolean;
  isPlaceholderData: boolean;
  isFetching: boolean;
  displayedResults: number;
};

/** One positive query/filter combination per mounted search visit. The key is
 * in memory only: no query, filter, or identifier goes into the event payload. */
export function useSearchMetric({
  event,
  query,
  context,
  page = 1,
  isSuccess,
  isPlaceholderData,
  isFetching,
  displayedResults,
}: SearchMetric) {
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const value = query.trim().toLocaleLowerCase('en-US');
    const key = JSON.stringify([value, context]);
    if (
      !value ||
      page !== 1 ||
      !isSuccess ||
      isPlaceholderData ||
      isFetching ||
      displayedResults < 1 ||
      recorded.current.has(key)
    ) {
      return;
    }
    recorded.current.add(key);
    recordSiteMetricEvent(event);
  }, [event, query, context, page, isSuccess, isPlaceholderData, isFetching, displayedResults]);
}
