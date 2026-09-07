import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getSiteMetricCollectionDecisionFromApi } from '../data/api';
import { redactTrafficUrl } from '../lib/traffic';
import { setSiteMetricSession } from '../lib/siteMetricEvents';
import { isPrivateMetricLocation, isPrivateMetricUrl } from '../lib/siteMetricPrivacy';
import { useAuth } from '../providers/AuthProvider';

export function TrafficAnalytics() {
  const { accessToken, isLoading, isSignedIn, user } = useAuth();
  const [decision, setDecision] = useState<{
    userId: string;
    token: string;
    collect: boolean;
  } | null>(null);
  const [started, setStarted] = useState(false);
  const userId = user?.id;
  const sessionReady =
    !isLoading && (isSignedIn ? Boolean(userId && accessToken) : !userId && !accessToken);
  const collect =
    sessionReady &&
    (!isSignedIn ||
      (decision?.userId === userId &&
        decision?.token === accessToken &&
        decision?.collect === true));
  // Vercel's script outlives <Analytics>. Its callback must check permission
  // when each event leaves, including during a change of signed-in account.
  const mayCollect = useRef(false);
  mayCollect.current = collect;
  const beforeSend = useCallback((event: BeforeSendEvent) => {
    const url = redactTrafficUrl(event.url);
    return mayCollect.current && !isPrivateMetricUrl(url) && !isPrivateMetricLocation()
      ? { ...event, url }
      : null;
  }, []);

  useEffect(() => {
    setSiteMetricSession(accessToken, sessionReady);
    return () => setSiteMetricSession(null, false);
  }, [accessToken, sessionReady]);

  useEffect(() => {
    setDecision(null);
    if (!sessionReady || !isSignedIn || !userId || !accessToken) return;

    const controller = new AbortController();

    void getSiteMetricCollectionDecisionFromApi(accessToken, controller.signal)
      .then((decision) => {
        if (!controller.signal.aborted) {
          setDecision({ userId, token: accessToken, collect: decision.collect });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDecision({ userId, token: accessToken, collect: false });
      });

    return () => controller.abort();
  }, [sessionReady, isSignedIn, userId, accessToken]);

  useEffect(() => {
    mayCollect.current = collect;
    if (collect) setStarted(true);
  }, [collect]);

  // Permission changes already update the ref during render. A dependency
  // cleanup would turn it off again before the newly mounted script can emit.
  useEffect(
    () => () => {
      mayCollect.current = false;
    },
    [],
  );

  // The provider emits its first view on mount, without retrying a rejected one.
  // Wait for the first eligible visit, then keep the event-time gate mounted.
  return started || collect ? <Analytics beforeSend={beforeSend} /> : null;
}
