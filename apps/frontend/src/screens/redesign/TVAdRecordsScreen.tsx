import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../providers/AuthProvider';
import { TopNav, Footer } from '../../theme/primitives';
import { targetFromPathname } from '../../navigation/webRoutes';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { notFoundPageMetadata, titleFor } from '../../lib/share';
import type { RootScreenProps } from '../../navigation/types';
import { NotFoundScreen } from './NotFoundScreen';
import { useTVAdAccess } from '../../components/tvAds/useTVAdAccess';
import { AdminMarker, Busy, TVSession, tvStyles } from '../../components/tvAds/pieces';
import { safeTVReturn } from '../../components/tvAds/api';
import { TVGuide } from '../../components/tvAds/Guide';
import { TVLanding } from '../../components/tvAds/Landing';
import { TVAgency, TVExpense, TVFile, TVFolder, TVStation } from '../../components/tvAds/Records';

export function TVAdRecordsScreen({ navigation, route }: RootScreenProps<'TVAdRecords'>) {
  const screenIdentity = `${route.params.kind}:${route.params.key || ''}`;
  const access = useTVAdAccess(screenIdentity);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screenIdentity, access.state]);
  const { user, accessToken } = useAuth();
  const [denied, setDenied] = useState(false);
  const reject = useCallback(() => setDenied(true), []);
  const onParams = useCallback(
    (params: Record<string, string | undefined>) => navigation.setParams(params),
    [navigation],
  );
  const followTVLink = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const href = anchor.getAttribute('href') || '';
      if (!(
        href === '/money/ads' ||
        href.startsWith('/money/ads?') ||
        href.startsWith('/money/ads/')
      ))
        return;
      const target = targetFromPathname(href);
      if (target.kind !== 'tvAdRecords') return;
      event.preventDefault();
      navigation.navigate('TVAdRecords', target.params);
    },
    [navigation],
  );
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/money/ads';
  const notFound =
    denied ||
    access.state === 'signed-out' ||
    access.state === 'restricted' ||
    access.state === 'error';
  // The server answers every TV address with the not-found page, so the tab keeps that
  // title until a fresh administrator check passes; a pending check or any refusal
  // shows it again, so no TV wording reaches another reader's tab.
  useDocumentTitle(
    pathname,
    !notFound && access.state === 'allowed' && accessToken
      ? titleFor(route.params.kind === 'guide' ? 'How to read TV ad records' : 'TV ad records')
      : notFoundPageMetadata().title,
  );
  if (notFound)
    return (
      <NotFoundScreen
        navigation={navigation as unknown as RootScreenProps<'NotFound'>['navigation']}
        route={{ key: 'tv-not-found', name: 'NotFound', params: { path: pathname } }}
      />
    );
  if (access.state !== 'allowed' || !accessToken)
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f6f7' }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <div className="tv">
          <style>{tvStyles}</style>
          <Busy label="Loading" />
        </div>
        <Footer />
      </View>
    );
  const params = route.params;
  if (params.kind === 'guide') return <TVGuide navigation={navigation} />;
  return (
    <TVSession.Provider
      key={`${user?.id}:${accessToken}`}
      value={{ token: accessToken, denied: reject }}
    >
      <View style={{ flex: 1, backgroundColor: '#f5f6f7' }}>
        <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1 }}>
          <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
          <main className="tv" key={screenIdentity} onClick={followTVLink}>
            <style>{tvStyles}</style>
            <a
              className="tv-back"
              href={params.kind === 'landing' ? '/money' : safeTVReturn(params.from || null)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{ flex: 'none' }}
              >
                <path
                  d="M15 5 L8 12 L15 19"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {params.kind === 'landing' ? 'Back to Money in politics' : 'Back to TV ad records'}
            </a>
            <AdminMarker />
            {params.kind === 'landing' ? (
              <TVLanding params={params} onParams={onParams} />
            ) : params.kind === 'file' &&
              'expense' in params &&
              typeof params.expense === 'string' ? (
              <TVExpense expenseId={params.expense} notFound={reject} />
            ) : params.kind === 'file' ? (
              <TVFile
                fileKey={params.key || ''}
                version={params.version}
                params={params}
                onParams={onParams}
                notFound={reject}
              />
            ) : params.kind === 'folder' ? (
              <TVFolder recordKey={params.key || ''} notFound={reject} />
            ) : params.kind === 'agency' ? (
              <TVAgency recordKey={params.key || ''} notFound={reject} />
            ) : (
              <TVStation recordKey={params.key || ''} notFound={reject} />
            )}
          </main>
          <Footer />
        </ScrollView>
      </View>
    </TVSession.Provider>
  );
}
