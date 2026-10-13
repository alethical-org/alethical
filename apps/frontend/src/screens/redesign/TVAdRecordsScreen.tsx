import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../providers/AuthProvider';
import { TopNav, Footer } from '../../theme/primitives';
import type { RootScreenProps } from '../../navigation/types';
import { NotFoundScreen } from './NotFoundScreen';
import { useTVAdAccess } from '../../components/tvAds/useTVAdAccess';
import { AdminMarker, Busy, TVSession, tvStyles } from '../../components/tvAds/pieces';
import { safeTVReturn } from '../../components/tvAds/api';
import { TVGuide } from '../../components/tvAds/Guide';
import { TVLanding } from '../../components/tvAds/Landing';
import { TVAgency, TVExpense, TVFile, TVFolder, TVStation } from '../../components/tvAds/Records';

export function TVAdRecordsScreen({ navigation, route }: RootScreenProps<'TVAdRecords'>) {
  const access = useTVAdAccess();
  const { user, accessToken } = useAuth();
  const [denied, setDenied] = useState(false);
  const reject = useCallback(() => setDenied(true), []);
  const onParams = useCallback(
    (params: Record<string, string | undefined>) => navigation.setParams(params),
    [navigation],
  );
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/money/ads';
  if (
    denied ||
    access.state === 'signed-out' ||
    access.state === 'restricted' ||
    access.state === 'error'
  )
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
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
          <main className="tv">
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
