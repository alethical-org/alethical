import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';
import { useEffect, useState } from 'react';

import { redactTrafficUrl } from '../lib/traffic';
import { setSiteMetricSession } from '../lib/siteMetricEvents';
import { useAuth } from '../providers/AuthProvider';

type CollectionDecision = { collect: boolean; teamAccount: boolean };

function isCollectionDecision(value: unknown): value is CollectionDecision {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as CollectionDecision).collect === 'boolean' &&
    typeof (value as CollectionDecision).teamAccount === 'boolean',
  );
}

export function TrafficAnalytics() {
  const { accessToken, isLoading, isSignedIn, user } = useAuth();
  const [collect, setCollect] = useState(false);

  useEffect(() => {
    setSiteMetricSession(accessToken, !isLoading);
    return () => setSiteMetricSession(null, false);
  }, [accessToken, isLoading]);

  useEffect(() => {
    if (isLoading) return;

    if (!isSignedIn || !user) {
      setCollect(true);
      return;
    }

    const controller = new AbortController();
    setCollect(false);

    void fetch('/api/traffic-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        return isCollectionDecision(payload) ? payload : null;
      })
      .then((decision) => {
        if (!controller.signal.aborted) setCollect(decision?.collect === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCollect(false);
      });

    return () => controller.abort();
  }, [isLoading, isSignedIn, user]);

  if (!collect) return null;

  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => ({
        ...event,
        url: redactTrafficUrl(event.url),
      })}
    />
  );
}
