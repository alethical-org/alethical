import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CandidateLink } from '../../components/candidates/CandidateControls';
import { SearchPageShell } from '../../components/search/searchPieces';
import { FolderMetadata } from '../../components/tvAdReview/FolderMetadata';
import { FolderReview } from '../../components/tvAdReview/FolderReview';
import { CheckedReview } from '../../components/tvAdReview/CheckedReview';
import { PrepareReview } from '../../components/tvAdReview/PrepareReview';
import {
  ReviewAction,
  ReviewField,
  reviewStyles as s,
} from '../../components/tvAdReview/ReviewControls';
import {
  denied,
  prepareCopy,
  reviewError,
  reviewRequest,
  sourcePath,
  type QueuePayload,
  type QueueRow,
  type VersionPayload,
} from '../../components/tvAdReview/api';
import {
  centralDate,
  type PrepareCopy,
  type ReviewPayload,
} from '../../components/tvAdReview/types';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useResponsive } from '../../hooks/useResponsive';
import { useDocumentTitle } from '../../navigation/documentTitle';
import type { MenuKey } from '../../navigation/ia';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import type { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import { theme as t } from '../../theme/tokens';
import { NotFoundScreen } from './NotFoundScreen';

function ReviewWorkspace({ token, onDenied }: { token: string; onDenied(): void }) {
  const [station, setStation] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ station: '', query: '', page: 1 });
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [queueBusy, setQueueBusy] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [version, setVersion] = useState<VersionPayload | null>(null);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCopy, setReloadCopy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (version && typeof document !== 'undefined')
      document.getElementById('tv-ad-review-selected')?.scrollIntoView?.({ block: 'start' });
  }, [version?.document.content_hash]);
  useEffect(() => {
    const request = new AbortController();
    setQueueBusy(true);
    setQueueError(false);
    const params = new URLSearchParams({
      station: search.station,
      q: search.query,
      page: String(search.page),
    });
    void reviewRequest<QueuePayload>(token, `/queue?${params}`, request.signal).then(
      (result) => {
        if (!request.signal.aborted) {
          setQueue(result);
          setQueueBusy(false);
        }
      },
      (error: unknown) => {
        if (!request.signal.aborted) {
          if (denied(error)) onDenied();
          else {
            setQueueError(true);
            setQueueBusy(false);
          }
        }
      },
    );
    return () => request.abort();
  }, [token, search, retry, onDenied]);
  const start = () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setMessage('');
    return next;
  };
  const failed = (error: unknown, request: AbortController) => {
    if (request.signal.aborted) return;
    if (denied(error)) onDenied();
    else {
      setMessage(reviewError(error));
      setBusy(false);
    }
  };
  const select = async (row: QueueRow) => {
    const request = start();
    setReview(null);
    setReloadCopy(null);
    setVersion(null);
    try {
      const data = await reviewRequest<VersionPayload>(token, sourcePath(row), request.signal);
      if (!request.signal.aborted) {
        setVersion(data);
        setBusy(false);
      }
    } catch (error) {
      failed(error, request);
    }
  };
  const openCopy = async (id: string) => {
    const request = start();
    try {
      const data = await reviewRequest<ReviewPayload>(
        token,
        `/copies/${encodeURIComponent(id)}/review`,
        request.signal,
      );
      if (!request.signal.aborted) {
        setReview(data);
        setBusy(false);
      }
    } catch (error) {
      failed(error, request);
    }
  };
  const prepare = async (data: PrepareCopy) => {
    const request = start();
    try {
      const result = await prepareCopy(token, data, request.signal);
      if (!request.signal.aborted) {
        setReview(result);
        setVersion((current) =>
          current
            ? {
                ...current,
                copies: [
                  {
                    id: result.publication.id,
                    status: result.publication.status,
                    created_at: result.publication.created_at,
                  },
                  ...current.copies,
                ],
              }
            : current,
        );
        setBusy(false);
        setMessage(
          result.publication.metadata_only
            ? 'Metadata prepared. Inspect the title, folder label and category before approving.'
            : 'Prepared copy saved. Inspect every prepared page before approving.',
        );
      }
    } catch (error) {
      failed(error, request);
    }
  };
  const mutate = async (path: string, data: object, done?: () => void) => {
    if (busy || !review) return;
    const currentCopy = review.publication.id;
    const request = start();
    try {
      await reviewRequest<unknown>(token, path, request.signal, data);
      // The mutation can succeed even when the refresh fails. Clear stale content,
      // especially after withdrawal, and never offer an old approval button.
      if (request.signal.aborted) return;
      setReview(null);
      setReloadCopy(currentCopy);
      const result = await reviewRequest<ReviewPayload>(
        token,
        `/copies/${encodeURIComponent(currentCopy)}/review`,
        request.signal,
      );
      if (!request.signal.aborted) {
        setReview(result);
        setBusy(false);
        setReloadCopy(null);
        setMessage('Review saved');
        done?.();
      }
    } catch (error) {
      failed(error, request);
    }
  };
  return (
    <View style={s.stack}>
      <View style={version ? { display: 'none' } : undefined}>
        <View style={s.row}>
          <ReviewField
            label="Find a station file"
            value={query}
            onChange={setQuery}
            disabled={busy}
          />
          <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px' }}>
            Station
            <select
              aria-label="Station"
              value={station}
              disabled={busy}
              onChange={(event) => setStation(event.target.value)}
              style={{ display: 'block', minHeight: 48, font: 'inherit' }}
            >
              <option value="">All 3 stations</option>
              {['KSTP-TV', 'KARE', 'KMSP-TV'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <ReviewAction
            label="Search private queue"
            disabled={busy}
            onPress={() => setSearch({ station, query: query.trim(), page: 1 })}
          />
        </View>
        <View style={s.notice} accessibilityLiveRegion="polite">
          <Text style={s.note}>
            {queueBusy
              ? queue
                ? 'Updating the queue; previous results remain below'
                : 'Loading review queue…'
              : queueError
                ? 'We couldn’t update the queue. Previous results remain below.'
                : ''}
          </Text>
        </View>
        {queueError ? (
          <ReviewAction label="Retry queue" onPress={() => setRetry((value) => value + 1)} />
        ) : null}
        {queue ? (
          <>
            <Text style={s.note}>
              {queue.total.toLocaleString('en-US')} source{' '}
              {queue.total === 1 ? 'version' : 'versions'} · page {queue.page}
            </Text>
            {queue.rows.length === 0 ? (
              <Text style={s.body}>No station files match this search</Text>
            ) : (
              queue.rows.map((row) => (
                <View key={`${row.facility_id}:${row.file_id}:${row.content_hash}`} style={s.card}>
                  <Text style={s.label}>
                    {row.call_sign} · {row.name}
                  </Text>
                  <Text style={s.note}>{row.folder_path}</Text>
                  <Text style={s.note}>First saved: {centralDate(row.first_saved_at)}</Text>
                  <Text style={s.note}>
                    {row.uploaded_at
                      ? `Source upload: ${centralDate(row.uploaded_at)}`
                      : 'Upload date unavailable'}{' '}
                    · {row.page_count} {row.page_count === 1 ? 'page' : 'pages'} · {row.status}
                  </Text>
                  <ReviewAction
                    label={`Review ${row.name}`}
                    disabled={busy}
                    onPress={() => void select(row)}
                  />
                </View>
              ))
            )}
            <View style={s.row}>
              <ReviewAction
                label="Previous queue page"
                disabled={busy || queueBusy || queue.page <= 1}
                onPress={() => setSearch((value) => ({ ...value, page: queue.page - 1 }))}
              />
              <ReviewAction
                label="Next queue page"
                disabled={busy || queueBusy || queue.page * queue.page_size >= queue.total}
                onPress={() => setSearch((value) => ({ ...value, page: queue.page + 1 }))}
              />
            </View>
          </>
        ) : null}
      </View>
      <View style={s.notice} accessibilityLiveRegion="polite" aria-busy={busy}>
        <Text style={s.body}>{busy ? 'Loading or saving this review…' : message}</Text>
      </View>
      {version ? (
        <View nativeID="tv-ad-review-selected" style={s.stack}>
          <ReviewAction
            label="Return to the review queue"
            disabled={busy}
            onPress={() => {
              setVersion(null);
              setReview(null);
              setReloadCopy(null);
              setMessage('');
            }}
          />
          {reloadCopy && !review ? (
            <ReviewAction
              label="Reload saved review"
              disabled={busy}
              onPress={() => void openCopy(reloadCopy)}
            />
          ) : null}
          <Text accessibilityRole="header" aria-level={2} style={s.h2}>
            {version.document.call_sign} · {version.document.name}
          </Text>
          <Text selectable style={s.note}>
            Source contents: {version.document.content_hash}
          </Text>
          <Text style={s.note}>First saved: {centralDate(version.document.first_saved_at)}</Text>
          <View style={s.row}>
            {version.copies.map((copy) => (
              <ReviewAction
                key={copy.id}
                label={`Open ${copy.status} copy · ${centralDate(copy.created_at)}`}
                disabled={busy}
                onPress={() => void openCopy(copy.id)}
              />
            ))}
          </View>
          {review ? (
            <CheckedReview
              key={`${review.publication.id}:${review.publication.fingerprint}:${review.publication.status}`}
              token={token}
              review={review}
              extractionVersion={version.document.extraction_version}
              busy={busy}
              onDenied={onDenied}
              onMutation={(path, data, done) => void mutate(path, data, done)}
              onEdit={() => {
                setReview(null);
                setMessage(
                  'Prepare the correction, then withdraw any earlier approved copy before approving its replacement',
                );
              }}
            />
          ) : !reloadCopy ? (
            <PrepareReview
              key={`${version.document.facility_id}:${version.document.file_id}:${version.document.content_hash}`}
              token={token}
              version={version}
              busy={busy}
              onDenied={onDenied}
              onPrepare={(data) => void prepare(data)}
            />
          ) : null}
          {review?.publication.status === 'approved' ? (
            <FolderReview
              version={version}
              token={token}
              publicationId={review.publication.id}
              busy={busy}
              onDenied={onDenied}
              onMutation={(path, data) => void mutate(path, data)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PrivateAdminAds({
  navigation,
  token,
  onDenied,
}: {
  navigation: RootScreenProps<'AdminPoliticalAds'>['navigation'];
  token: string;
  onDenied(): void;
}) {
  const { isMobile } = useResponsive();
  const [menu, setMenu] = useState<MenuKey | null>(null);
  useDocumentTitle('/admin/political-ads', 'Review TV ad records | Alethical');
  return (
    <SearchPageShell
      openMenu={menu}
      onOpenMenuChange={setMenu}
      onNavigate={(item) => navigateTopNavItem(navigation, item)}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={
        <View style={s.stack}>
          <CandidateLink
            label="Back to TV ad records"
            url="/money/ads"
            internal
            direction="back"
            onPress={() => navigation.navigate('TVAdRecords', { kind: 'landing' })}
          />
          <Text style={s.label}>Admin</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={{
              fontFamily: t.typography.title,
              fontSize: isMobile ? 32 : 42,
              fontWeight: '700',
              color: t.colors.text.primary,
            }}
          >
            Review TV ad records
          </Text>
          <Text style={s.body}>
            Prepare safe copies, check facts and review connections. Source originals and review
            notes stay private.
          </Text>
        </View>
      }
    >
      <ReviewWorkspace token={token} onDenied={onDenied} />
      <FolderMetadata token={token} onDenied={onDenied} />
    </SearchPageShell>
  );
}
export function AdminPoliticalAdsScreen({
  navigation,
}: {
  navigation: RootScreenProps<'AdminPoliticalAds'>['navigation'];
}) {
  const { user, accessToken } = useAuth();
  const access = useAdminAccess();
  const [revoked, setRevoked] = useState<string | null>(null);
  const identity = `${user?.id ?? ''}:${accessToken ?? ''}`;
  const onDenied = useCallback(() => setRevoked(identity), [identity]);
  if (access.state !== 'allowed' || !user || !accessToken || revoked === identity)
    return (
      <NotFoundScreen
        navigation={navigation as unknown as RootScreenProps<'NotFound'>['navigation']}
        route={{
          key: 'private-not-found',
          name: 'NotFound',
          params: { path: '/admin/political-ads' },
        }}
      />
    );
  return (
    <PrivateAdminAds
      key={identity}
      navigation={navigation}
      token={accessToken}
      onDenied={onDenied}
    />
  );
}
