import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CandidateLink } from '../../components/candidates/CandidateControls';
import { SearchPageShell } from '../../components/search/searchPieces';
import { FolderMetadata } from '../../components/tvAdReview/FolderMetadata';
import { FolderReview } from '../../components/tvAdReview/FolderReview';
import { CheckedReview } from '../../components/tvAdReview/CheckedReview';
import { PrepareReview } from '../../components/tvAdReview/PrepareReview';
import type { SuggestionState } from '../../components/tvAdReview/Suggestions';
import { QueueRow as QueueFileRow } from '../../components/tvAdReview/QueueRow';
import {
  ReviewAction,
  ReviewField,
  ReviewSelect,
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
  type ReviewSuggestions,
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

const groupHeading = {
  fontFamily: t.typography.ui,
  fontSize: 17,
  lineHeight: 24,
  fontWeight: '800' as const,
  color: t.colors.text.primary,
};
const groupNote = { ...s.note, fontSize: 14.5, color: '#4f5651' };

function ReviewWorkspace({ token, onDenied }: { token: string; onDenied(): void }) {
  const { isMobile, isTablet } = useResponsive();
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
  const [suggestions, setSuggestions] = useState<SuggestionState | null>(null);
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const [dismissed, setDismissed] = useState<{ copyId: string; keys: Set<string> } | null>(null);
  const suggestionCopy = review?.publication.status === 'approved' ? review.publication.id : null;
  const suggestionRefresh = review
    ? `${review.facts.length}:${review.connections.length}:${review.publication.fingerprint}`
    : null;
  // Suggestions belong to one approved copy. Keep the last list visible while a
  // refresh after a saved decision loads; a different copy starts empty.
  useEffect(() => {
    if (!suggestionCopy || suggestionRefresh === null) return;
    const request = new AbortController();
    setSuggestions((current) =>
      current?.copyId === suggestionCopy
        ? { ...current, busy: true, error: false }
        : { copyId: suggestionCopy, busy: true, error: false },
    );
    void reviewRequest<ReviewSuggestions>(
      token,
      `/copies/${encodeURIComponent(suggestionCopy)}/suggestions`,
      request.signal,
    ).then(
      (data) => {
        if (!request.signal.aborted)
          setSuggestions({ copyId: suggestionCopy, data, busy: false, error: false });
      },
      (error: unknown) => {
        if (request.signal.aborted) return;
        if (denied(error)) onDenied();
        else
          setSuggestions((current) =>
            current?.copyId === suggestionCopy
              ? { ...current, busy: false, error: true }
              : { copyId: suggestionCopy, busy: false, error: true },
          );
      },
    );
    return () => request.abort();
  }, [token, suggestionCopy, suggestionRefresh, suggestionRetry, onDenied]);

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
        <View
          style={
            isMobile
              ? { gap: 12 }
              : isTablet
                ? { gap: 12 }
                : { flexDirection: 'row', alignItems: 'flex-end', gap: 12 }
          }
        >
          <View style={isMobile || isTablet ? undefined : { flex: 1, minWidth: 0 }}>
            <ReviewField
              label="Find a station file"
              value={query}
              onChange={setQuery}
              disabled={busy}
            />
          </View>
          <View
            style={
              isTablet
                ? { flexDirection: 'row', alignItems: 'flex-end', gap: 12 }
                : isMobile
                  ? { gap: 12 }
                  : { flexDirection: 'row', alignItems: 'flex-end', gap: 12 }
            }
          >
            <ReviewSelect
              label="Station"
              value={station}
              disabled={busy}
              fill={isMobile}
              onChange={setStation}
              options={[
                { value: '', label: 'All 3 stations' },
                ...['KSTP-TV', 'KARE', 'KMSP-TV'].map((name) => ({ value: name, label: name })),
              ]}
            />
            <View style={isMobile ? { alignSelf: 'stretch' } : undefined}>
              <ReviewAction
                label="Search private queue"
                disabled={busy}
                onPress={() => setSearch({ station, query: query.trim(), page: 1 })}
              />
            </View>
          </View>
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
            <Text style={[s.note, { marginBottom: 12 }]}>
              {queue.total.toLocaleString('en-US')} source{' '}
              {queue.total === 1 ? 'version' : 'versions'} · page {queue.page}
            </Text>
            {queue.rows.length === 0 ? (
              <Text style={s.body}>No station files match this search</Text>
            ) : (
              [
                queue.rows.filter((row) => row.suggested_first),
                queue.rows.filter((row) => !row.suggested_first),
              ].map((rows, index, groups) =>
                rows.length ? (
                  <View key={index} style={{ gap: 12, marginBottom: 24 }}>
                    {groups[0].length ? (
                      <View style={{ gap: 4 }}>
                        <Text accessibilityRole="header" aria-level={3} style={groupHeading}>
                          {index === 0 ? 'Suggested first' : 'Newest first'}
                        </Text>
                        {index === 0 ? (
                          <Text style={groupNote}>
                            Files without an approved copy whose machine-read agency name is already
                            checked on another file, or whose folder was checked as relating to a
                            committee
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {rows.map((row) => (
                      <QueueFileRow
                        key={`${row.facility_id}:${row.file_id}:${row.content_hash}`}
                        row={row}
                        disabled={busy}
                        onOpen={() => void select(row)}
                      />
                    ))}
                  </View>
                ) : null,
              )
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
              suggestions={suggestions?.copyId === review.publication.id ? suggestions : null}
              dismissed={
                dismissed?.copyId === review.publication.id ? dismissed.keys : new Set<string>()
              }
              onDismiss={(key) =>
                setDismissed((current) => ({
                  copyId: review.publication.id,
                  keys: new Set([
                    ...(current?.copyId === review.publication.id ? current.keys : []),
                    key,
                  ]),
                }))
              }
              onRestore={(keys) =>
                setDismissed((current) =>
                  current
                    ? {
                        ...current,
                        keys: new Set([...current.keys].filter((key) => !keys.includes(key))),
                      }
                    : current,
                )
              }
              onRetrySuggestions={() => setSuggestionRetry((value) => value + 1)}
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
