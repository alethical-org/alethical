import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import {
  CandidateDialog,
  CandidateField,
  candidateAccountStyles,
} from '../components/candidates/CandidateAccountControls';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
  safeCandidateUrl,
} from '../components/candidates/CandidateControls';
import { ProfileClaimButton } from '../components/candidates/ProfileClaimButton';
import {
  profileClaimCopy as copy,
  profileClaimHeadings,
  profileClaimErrorReason,
  profileClaimNoteError,
  profileClaimTime,
} from '../components/candidates/profileClaimCopy';
import {
  getAdminCandidateClaims,
  getAdminCandidateClaim,
  recheckCandidateClaim,
  getCandidateStatementReports,
  reviewCandidateClaim,
  resolveCandidateStatementReport,
  profileClaimsChanged,
  type CandidateClaim,
  type CandidateClaimDetail,
  type CandidateClaimList,
  type CandidateStatementReports,
  type ProfileClaimEvent,
} from '../data/candidateClaims';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { useResponsive } from '../hooks/useResponsive';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { Footer, PageBackground, TopNav } from '../theme/primitives';

type AdminNavigation = RootScreenProps<'AdminCandidateClaims'>['navigation'];
function accessDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error.status === 401 || error.status === 403),
  );
}
function ClaimContext({
  claim,
  status = true,
}: {
  claim: Pick<
    CandidateClaim,
    'candidate_name' | 'office' | 'voting_area' | 'election_name' | 'election_date'
  > &
    Partial<CandidateClaim>;
  status?: boolean;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={[candidateText.strong, { fontSize: 21, lineHeight: 28 }]}>
        {claim.candidate_name}
      </Text>
      {status && claim.status ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Text
            style={{
              ...candidateText.strong,
              fontSize: 13,
              paddingVertical: 5,
              paddingHorizontal: 10,
              backgroundColor: claim.status === 'approved' ? '#e4f8ee' : '#f1f2f4',
              borderRadius: 7,
            }}
          >
            {profileClaimHeadings[claim.status]}
          </Text>
          {claim.election_ended ? (
            <Text
              style={{
                ...candidateText.strong,
                fontSize: 13,
                paddingVertical: 5,
                paddingHorizontal: 10,
                backgroundColor: '#fdf3ee',
                borderRadius: 7,
              }}
            >
              Election ended
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={candidateText.body}>
        {[claim.office, claim.voting_area].filter(Boolean).join(' · ')}
      </Text>
      <Text style={candidateText.body}>
        {[claim.election_name, claim.election_date && candidateDate(claim.election_date)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}
const eventNames: Record<ProfileClaimEvent['kind'], string> = {
  submitted: 'Profile claim request submitted',
  resubmitted: 'Profile claim request resubmitted',
  withdrawn: 'Profile claim request withdrawn',
  given_up: 'Profile claim given up',
  approved: 'Profile claim approved',
  rejected: 'Profile claim request rejected',
  revoked: 'Profile claim revoked',
};
function ClaimHistory({ claim }: { claim: CandidateClaim }) {
  return (
    <View style={{ gap: 16, marginTop: 24 }}>
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[candidateText.title, { fontSize: 24, lineHeight: 30 }]}
      >
        Profile claim history
      </Text>
      {claim.history?.map((event) => (
        <View key={event.id} style={[candidateAccountStyles.identity, { marginTop: 0, gap: 10 }]}>
          <Text style={candidateText.strong}>{eventNames[event.kind]}</Text>
          <Text style={candidateText.body}>
            {[profileClaimTime(event.created_at), event.actor_name].filter(Boolean).join(' · ')}
          </Text>
          {event.candidate?.candidate_name ? (
            <ClaimContext
              claim={{
                candidate_name: event.candidate.candidate_name,
                office: event.candidate.office ?? '',
                ...event.candidate,
              }}
              status={false}
            />
          ) : null}
          {event.evidence_url ? (
            <View style={{ gap: 5 }}>
              <Text style={candidateText.strong}>{copy.link}</Text>
              <CandidateLink label={event.evidence_url} url={event.evidence_url} />
            </View>
          ) : null}
          {event.request_note ? (
            <View style={{ gap: 5 }}>
              <Text style={candidateText.strong}>{copy.explanation}</Text>
              <Text style={candidateText.body}>{event.request_note}</Text>
            </View>
          ) : null}
          {event.review_note ? (
            <View style={{ gap: 5 }}>
              <Text style={candidateText.strong}>Private review note</Text>
              <Text style={candidateText.body}>{event.review_note}</Text>
            </View>
          ) : null}
        </View>
      ))}
      {!claim.history?.length && claim.review_note ? (
        <View style={{ gap: 5 }}>
          <Text style={candidateText.strong}>Private review note</Text>
          <Text style={candidateText.body}>{claim.review_note}</Text>
        </View>
      ) : null}
      {!claim.history_complete ? (
        <Text style={candidateText.body}>Earlier profile claim history is unavailable</Text>
      ) : null}
    </View>
  );
}
const blocks: Record<string, string> = {
  election_ended:
    'This election has ended, so this profile claim request can no longer be approved',
  official_record_mismatch:
    'The official candidate record could not be confirmed, so this profile claim request cannot be approved',
  official_record_stale:
    'The official candidate record must be checked again before this profile claim request can be approved',
  profile_already_claimed:
    'This candidate profile already has an approved profile claim. Review the existing profile claim before approving another account.',
  applicant_is_admin: 'Admin accounts cannot claim candidate profiles',
  email_unconfirmed:
    'The applicant must confirm their account email before this profile claim request can be approved',
  account_inactive: 'The applicant’s account has been deactivated',
};
function ClaimDetail({
  token,
  id,
  navigation,
  onDenied,
}: {
  token: string;
  id: string;
  navigation: AdminNavigation;
  onDenied(): void;
}) {
  const { isMobile } = useResponsive();
  const lifetime = useRef<AbortController | null>(null);
  const reading = useRef<AbortController | null>(null);
  const [result, setResult] = useState<CandidateClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<'load' | 'unavailable' | 'changed' | 'unknown' | null>(
    null,
  );
  const [busy, setBusy] = useState<'approve' | 'reject' | 'revoke' | 'recheck' | null>(null);
  const writing = useRef(false);
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [noteError, setNoteError] = useState<string | undefined>();
  const [checkError, setCheckError] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState('');
  const [recheckFailed, setRecheckFailed] = useState(false);
  const noteRef = useRef<TextInput>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const claim = result?.claim;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      reading.current?.abort();
    };
  }, []);
  const load = async () => {
    reading.current?.abort();
    const scope = new AbortController();
    reading.current = scope;
    setLoading(true);
    setDialog(false);
    try {
      const value = await getAdminCandidateClaim(token, id, scope.signal);
      if (!scope.signal.aborted) {
        setResult(value);
        setFailure(null);
        setVerified(false);
        setCheckError(false);
        profileClaimsChanged();
      }
    } catch (error) {
      if (!scope.signal.aborted) {
        if (accessDenied(error)) onDenied();
        else
          setFailure(
            profileClaimErrorReason(error) === 'profile_claim_unavailable' ||
              (error as { status?: number })?.status === 404
              ? 'unavailable'
              : 'load',
          );
      }
    } finally {
      if (!scope.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const validate = (action: 'approve' | 'reject' | 'revoke') => {
    const invalid = profileClaimNoteError(note);
    setNoteError(invalid ?? undefined);
    setCheckError(action === 'approve' && !verified);
    if (invalid) noteRef.current?.focus();
    else if (action === 'approve' && !verified) checkRef.current?.focus();
    return !invalid && (action !== 'approve' || verified);
  };
  const act = async (action: 'approve' | 'reject' | 'revoke') => {
    const scope = lifetime.current;
    if (
      !scope ||
      !result ||
      writing.current ||
      loading ||
      failure ||
      !validate(action) ||
      (action === 'approve' && Boolean(claim?.approval_block))
    )
      return;
    writing.current = true;
    setBusy(action);
    setNotice('');
    try {
      const saved = await reviewCandidateClaim(
        token,
        id,
        {
          action,
          review_note: note,
          identity_verified: verified,
          expected_version: result.claim.version,
          expected_account_id: result.account_id,
        },
        scope.signal,
      );
      if (!scope.signal.aborted) {
        setResult(saved);
        setDialog(false);
        setVerified(false);
        setNote('');
        setNotice(
          action === 'approve'
            ? 'Profile claim request approved'
            : action === 'reject'
              ? 'Profile claim request rejected'
              : 'Profile claim revoked',
        );
        profileClaimsChanged();
      }
    } catch (error) {
      if (!scope.signal.aborted) {
        setDialog(false);
        const reason = profileClaimErrorReason(error);
        if (accessDenied(error) && reason && blocks[reason]) await load();
        else if (accessDenied(error)) onDenied();
        else if (reason === 'review_note_too_short' || reason === 'review_note_too_long')
          setNoteError(reason.endsWith('too_short') ? copy.noteShort : copy.noteLong);
        else if (reason === 'identity_verification_required') setCheckError(true);
        else if (reason === 'profile_claim_unavailable') setFailure('unavailable');
        else if (reason === 'profile_claim_changed' || reason === 'account_changed')
          setFailure('changed');
        else if (reason && blocks[reason]) {
          setResult({
            ...result,
            claim: { ...result.claim, approval_block: { reason, message: blocks[reason] } },
          });
        } else setFailure('unknown');
      }
    } finally {
      writing.current = false;
      if (!scope.signal.aborted) setBusy(null);
    }
  };
  const recheck = async () => {
    const scope = lifetime.current;
    if (!scope || writing.current || !result || loading || failure) return;
    writing.current = true;
    setBusy('recheck');
    setRecheckFailed(false);
    try {
      const updated = await recheckCandidateClaim(
        token,
        id,
        { expected_account_id: result.account_id, expected_version: result.claim.version },
        scope.signal,
      );
      if (!scope.signal.aborted) setResult(updated);
    } catch (error) {
      if (!scope.signal.aborted) {
        if (accessDenied(error)) onDenied();
        else setRecheckFailed(true);
      }
    } finally {
      writing.current = false;
      if (!scope.signal.aborted) setBusy(null);
    }
  };
  const allLink = (
    <CandidateLink
      internal
      label="View all profile claim requests"
      url="/admin/candidate-claims"
      onPress={() => navigation.navigate('AdminCandidateClaims', {})}
    />
  );
  if (failure === 'unavailable')
    return (
      <View style={{ gap: 14 }}>
        <Text style={candidateText.strong}>This profile claim request is unavailable</Text>
        {allLink}
      </View>
    );
  if (!claim)
    return (
      <View style={{ gap: 14 }}>
        {allLink}
        <Text role={failure ? 'alert' : 'status'} style={candidateText.body}>
          {failure
            ? 'We couldn’t load this profile claim request'
            : 'Loading profile claim request…'}
        </Text>
        {failure ? <ProfileClaimButton label="Try again" onPress={() => void load()} /> : null}
      </View>
    );
  const ownRequest = claim.user_id === result?.account_id;
  const block = claim.approval_block;
  const disabled = Boolean(busy) || loading || Boolean(failure);
  return (
    <View style={{ gap: 22 }}>
      {allLink}
      <View style={[candidateAccountStyles.identity, { marginTop: 0, gap: 18 }]}>
        <ClaimContext claim={claim} />
        <CandidateLink
          internal
          label="View public profile"
          url={`/candidates/${claim.candidate_id}`}
          onPress={() =>
            navigation.navigate('CandidateProfile', { candidateId: claim.candidate_id })
          }
        />
        <View style={{ gap: 4 }}>
          <Text style={candidateText.strong}>Applicant email</Text>
          <Text style={candidateText.body}>
            {claim.account_email ?? 'No confirmed account email available'}
          </Text>
          {claim.account_email ? (
            <Text style={[candidateText.body, { fontSize: 14 }]}>Confirmed account address</Text>
          ) : null}
        </View>
        <View style={{ gap: 4 }}>
          <Text style={candidateText.strong}>Submitted</Text>
          <Text style={candidateText.body}>
            {profileClaimTime(claim.submitted_at ?? claim.created_at)}
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={candidateText.strong}>{copy.link}</Text>
          <CandidateLink label={claim.evidence_url} url={claim.evidence_url} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={candidateText.strong}>{copy.explanation}</Text>
          <Text style={candidateText.body}>{claim.request_note}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={candidateText.strong}>Official candidate record</Text>
          {safeCandidateUrl(claim.official_source?.url ?? '') ? (
            <CandidateLink
              label={claim.official_source?.authority ?? 'Official candidate record'}
              url={claim.official_source!.url!}
            />
          ) : (
            <Text style={candidateText.body}>Official source unavailable</Text>
          )}
          {claim.official_checked_at ? (
            <Text style={candidateText.body}>
              Checked {profileClaimTime(claim.official_checked_at)}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ minHeight: 24 }} accessibilityLiveRegion="polite">
        <Text style={candidateText.strong}>
          {loading ? 'Loading profile claim request…' : notice}
        </Text>
      </View>
      {failure ? (
        <CandidateNotice error>
          <Text role="alert" style={candidateText.body}>
            {failure === 'changed'
              ? copy.changed
              : failure === 'unknown'
                ? copy.decisionUnknown
                : 'We couldn’t load this profile claim request'}
          </Text>
          <ProfileClaimButton
            label="Reload profile claim request"
            busy={loading}
            busyLabel="Loading profile claim request…"
            onPress={() => void load()}
          />
        </CandidateNotice>
      ) : null}
      {ownRequest ? (
        <CandidateNotice>
          <Text style={candidateText.body}>
            An administrator cannot review their own candidate profile claim
          </Text>
        </CandidateNotice>
      ) : null}
      {(claim.status === 'pending' || claim.status === 'approved') && !failure && !ownRequest ? (
        <View style={{ gap: 18 }}>
          {block && claim.status === 'pending' ? (
            <CandidateNotice>
              <Text nativeID="profile-approval-block" style={candidateText.body}>
                {blocks[block.reason] ?? block.message}
              </Text>
              {['official_record_stale', 'official_record_mismatch'].includes(block.reason) ? (
                <ProfileClaimButton
                  label="Recheck official record"
                  busyLabel="Rechecking official record…"
                  busy={busy === 'recheck'}
                  disabled={disabled}
                  onPress={() => void recheck()}
                />
              ) : null}
            </CandidateNotice>
          ) : null}
          {recheckFailed ? (
            <Text role="alert" style={[candidateText.strong, { color: '#a3421a' }]}>
              We couldn’t refresh the official candidate record. Approval remains unavailable; try
              again.
            </Text>
          ) : null}
          <CandidateField
            label="Private review note"
            value={note}
            onChange={setNote}
            multiline
            readOnly={disabled}
            error={noteError}
            hint={copy.noteHelp}
            inputRef={noteRef}
          />
          {claim.status === 'pending' ? (
            <View style={{ gap: 7 }}>
              <label
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  fontFamily: candidateText.body.fontFamily,
                  fontSize: 16,
                  lineHeight: '24px',
                  minHeight: 44,
                }}
              >
                <input
                  ref={checkRef}
                  type="checkbox"
                  className="profile-claim-input"
                  checked={verified}
                  disabled={disabled}
                  aria-invalid={checkError}
                  aria-describedby={checkError ? 'profile-identity-error' : undefined}
                  onChange={(event) => setVerified(event.target.checked)}
                  style={{
                    marginTop: 3,
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    accentColor: '#0f7a45',
                  }}
                />
                I independently verified this applicant’s identity and authority to represent this
                campaign
              </label>
              {checkError ? (
                <Text
                  nativeID="profile-identity-error"
                  role="alert"
                  style={[candidateText.strong, { color: '#a3421a' }]}
                >
                  {copy.verifyError}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View
            style={[
              candidateAccountStyles.actions,
              { marginTop: 0 },
              isMobile && { flexDirection: 'column', alignItems: 'stretch' },
            ]}
          >
            {claim.status === 'pending' ? (
              <>
                <ProfileClaimButton
                  label="Approve profile claim request"
                  busyLabel="Approving profile claim request…"
                  busy={busy === 'approve'}
                  kind="green"
                  width={isMobile ? '100%' : 340}
                  disabled={disabled || Boolean(block)}
                  describedBy={block ? 'profile-approval-block' : undefined}
                  onPress={() => void act('approve')}
                />
                <ProfileClaimButton
                  label="Reject profile claim request"
                  busyLabel="Rejecting profile claim request…"
                  busy={busy === 'reject'}
                  width={isMobile ? '100%' : 340}
                  disabled={disabled}
                  onPress={() => void act('reject')}
                />
              </>
            ) : (
              <ProfileClaimButton
                label="Revoke profile claim"
                kind="danger"
                disabled={disabled}
                width={isMobile ? '100%' : 270}
                onPress={() => {
                  if (validate('revoke')) setDialog(true);
                }}
              />
            )}
          </View>
        </View>
      ) : null}
      <ClaimHistory claim={claim} />
      {dialog ? (
        <CandidateDialog
          title="Revoke this profile claim?"
          onClose={() => {
            if (!busy) setDialog(false);
          }}
        >
          <Text style={candidateText.body}>
            This account will lose campaign access to manage the candidate profile’s statement
          </Text>
          {claim.has_published_statement ? (
            <Text style={candidateText.body}>
              Its published campaign statement will also be removed
            </Text>
          ) : null}
          <ProfileClaimButton
            label="Keep profile claim"
            kind="green"
            disabled={Boolean(busy)}
            onPress={() => setDialog(false)}
          />
          <ProfileClaimButton
            label="Revoke profile claim"
            busyLabel="Revoking profile claim…"
            busy={busy === 'revoke'}
            kind="danger"
            width={isMobile ? '100%' : 270}
            onPress={() => void act('revoke')}
          />
        </CandidateDialog>
      ) : null}
    </View>
  );
}
function ClaimsQueue({
  token,
  candidateId,
  fromProfile,
  navigation,
  onDenied,
}: {
  token: string;
  candidateId?: string;
  fromProfile?: boolean;
  navigation: AdminNavigation;
  onDenied(): void;
}) {
  const { isMobile } = useResponsive();
  const [request, setRequest] = useState<{
    filter: 'pending' | 'all';
    offset: number;
    attempt: number;
  }>({ filter: 'pending', offset: 0, attempt: 0 });
  const [loaded, setLoaded] = useState<{
    filter: 'pending' | 'all';
    offset: number;
    result: CandidateClaimList;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const top = useRef<View>(null);
  const pageChange = useRef(false);
  const cache = useRef(new Map<string, { result: CandidateClaimList; time: number }>());
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    setUnavailable(false);
    const key = `${request.filter}:${request.offset}`;
    const cached = cache.current.get(key);
    const fetch =
      cached && Date.now() - cached.time < 30000
        ? Promise.resolve(cached.result)
        : getAdminCandidateClaims(
            token,
            request.filter,
            controller.signal,
            request.offset,
            candidateId,
          );
    void fetch
      .then(
        (result) => {
          if (!controller.signal.aborted) {
            setLoaded({ filter: request.filter, offset: request.offset, result });
            cache.current.set(key, { result, time: Date.now() });
            if (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value!);
            // Prepare only the next page; never fetch every filter/page combination.
            const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
              .connection;
            const nextKey = `${request.filter}:${request.offset + 25}`;
            const nextCached = cache.current.get(nextKey);
            if (
              result.has_more &&
              !connection?.saveData &&
              (!nextCached || Date.now() - nextCached.time >= 30000)
            ) {
              void getAdminCandidateClaims(
                token,
                request.filter,
                controller.signal,
                request.offset + 25,
                candidateId,
              ).then(
                (next) => {
                  if (!controller.signal.aborted) {
                    cache.current.set(nextKey, { result: next, time: Date.now() });
                    if (cache.current.size > 6)
                      cache.current.delete(cache.current.keys().next().value!);
                  }
                },
                (error) => {
                  if (!controller.signal.aborted && accessDenied(error)) onDenied();
                },
              );
            }

            if (pageChange.current) {
              const element = top.current as unknown as HTMLElement;
              element?.focus?.();
              element?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
              pageChange.current = false;
            }
          }
        },
        (error) => {
          if (!controller.signal.aborted) {
            if (accessDenied(error)) onDenied();
            else if ((error as { status?: number })?.status === 404) setUnavailable(true);
            else setFailed(true);
          }
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [token, candidateId, request]);
  useEffect(() => {
    const invalidate = () => {
      cache.current.clear();
    };
    window.addEventListener('alethical-profile-claims-changed', invalidate);
    return () => window.removeEventListener('alethical-profile-claims-changed', invalidate);
  }, []);
  const refresh = () => {
    cache.current.clear();
    setRequest((value) => ({ ...value, attempt: value.attempt + 1 }));
  };
  const changePage = (offset: number) => {
    pageChange.current = true;
    setRequest((value) => ({ ...value, filter: loaded?.filter ?? value.filter, offset }));
  };
  return (
    <View style={{ gap: 20 }}>
      {candidateId ? (
        <>
          <CandidateLink
            internal
            label="View all profile claim requests"
            url="/admin/candidate-claims"
            onPress={() => navigation.navigate('AdminCandidateClaims', {})}
          />
          {fromProfile ? (
            <CandidateLink
              internal
              label="Back to candidate profile"
              url={`/candidates/${candidateId}`}
              onPress={() => navigation.navigate('CandidateProfile', { candidateId })}
            />
          ) : null}
          {loaded?.result.candidate ? (
            <View style={candidateAccountStyles.identity}>
              <ClaimContext claim={loaded.result.candidate} status={false} />
            </View>
          ) : null}
        </>
      ) : null}
      {unavailable ? (
        <Text style={candidateText.strong}>This candidate profile is unavailable</Text>
      ) : (
        <>
          <View
            style={{
              flexDirection: isMobile ? 'column' : 'row',
              gap: 16,
              alignItems: isMobile ? 'stretch' : 'center',
              flexWrap: 'wrap',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                gap: 6,
                padding: 5,
                backgroundColor: '#f1f2f4',
                borderRadius: 12,
              }}
            >
              {(['pending', 'all'] as const).map((value) => (
                <ProfileClaimButton
                  key={value}
                  label={value === 'pending' ? 'Pending' : 'All'}
                  selected={request.filter === value}
                  width={isMobile ? 'calc(50% - 3px)' : 112}
                  onPress={() =>
                    setRequest((current) => ({ ...current, filter: value, offset: 0 }))
                  }
                />
              ))}
            </View>
            <ProfileClaimButton
              label="Refresh profile claim requests"
              busyLabel="Refreshing profile claim requests…"
              width={isMobile ? '100%' : 360}
              busy={busy}
              onPress={refresh}
            />
          </View>
          <View style={{ minHeight: 24 }} accessibilityLiveRegion="polite">
            <Text style={candidateText.body}>
              {busy
                ? loaded
                  ? `Updating profile claim requests. Showing previous ${loaded.filter === 'pending' ? 'Pending' : 'All'} results, page ${loaded.offset / 25 + 1}.`
                  : 'Loading profile claim requests…'
                : loaded && (loaded.filter !== request.filter || loaded.offset !== request.offset)
                  ? `Showing previous ${loaded.filter === 'pending' ? 'Pending' : 'All'} results, page ${loaded.offset / 25 + 1}`
                  : ''}
            </Text>
          </View>
          {failed ? (
            <CandidateNotice error>
              <Text role="alert" style={candidateText.strong}>
                Profile claim requests are unavailable
              </Text>
              <ProfileClaimButton label="Try again" onPress={refresh} />
            </CandidateNotice>
          ) : null}
          <View
            ref={top}
            tabIndex={-1}
            aria-label="Profile claim requests"
            aria-busy={busy}
            style={{ minHeight: 220, opacity: busy && loaded ? 0.6 : 1, gap: 16 }}
          >
            {loaded?.result.claims.map((claim) => (
              <View
                key={claim.id}
                style={[candidateAccountStyles.identity, { marginTop: 0, gap: 14 }]}
              >
                <ClaimContext claim={claim} />
                <Text style={candidateText.body}>
                  {claim.account_email ?? 'No confirmed account email available'}
                </Text>
                <Text style={candidateText.body}>
                  Submitted {profileClaimTime(claim.submitted_at ?? claim.created_at)}
                </Text>
                <CandidateButton
                  label="Review profile claim request"
                  accessibilityLabel={`Review profile claim request for ${claim.candidate_name}`}
                  kind="outline"
                  icon="none"
                  href={`/admin/candidate-claims?claim=${encodeURIComponent(claim.id)}`}
                  onPress={() => navigation.navigate('AdminCandidateClaims', { claimId: claim.id })}
                />
              </View>
            ))}
            {loaded && !loaded.result.claims.length ? (
              <Text style={candidateText.body}>
                {loaded.filter === 'pending'
                  ? candidateId
                    ? 'No pending profile claim requests for this candidate'
                    : 'No pending profile claim requests'
                  : candidateId
                    ? 'No profile claim requests for this candidate'
                    : 'No profile claim requests'}
              </Text>
            ) : null}
          </View>
          {loaded ? (
            <View
              style={[
                candidateAccountStyles.actions,
                isMobile && { flexDirection: 'column', alignItems: 'stretch' },
              ]}
            >
              <ProfileClaimButton
                label="Previous profile claim requests"
                disabled={busy || loaded.offset === 0}
                width={isMobile ? '100%' : undefined}
                onPress={() => changePage(Math.max(0, loaded.offset - 25))}
              />
              <Text style={candidateText.body}>Page {loaded.offset / 25 + 1}</Text>
              <ProfileClaimButton
                label="Next profile claim requests"
                disabled={busy || !loaded.result.has_more}
                width={isMobile ? '100%' : undefined}
                onPress={() => changePage(loaded.offset + 25)}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
function ReportsQueue({ token, onDenied }: { token: string; onDenied(): void }) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<CandidateStatementReports | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const writing = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    void getCandidateStatementReports(token, offset, controller.signal)
      .then(
        (result) => {
          if (!controller.signal.aborted) setLoaded(result);
        },
        (error) => {
          if (!controller.signal.aborted) {
            if (accessDenied(error)) onDenied();
            else setFailed(true);
          }
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [token, offset, attempt]);
  const resolve = async (id: string) => {
    const scope = lifetime.current;
    if (!scope || !loaded || writing.current || busy) return;
    writing.current = true;
    setSaving(id);
    try {
      await resolveCandidateStatementReport(token, id, loaded.account_id, scope.signal);
      if (!scope.signal.aborted) setAttempt((value) => value + 1);
    } catch (error) {
      if (!scope.signal.aborted) {
        if (accessDenied(error)) onDenied();
        else setFailed(true);
      }
    } finally {
      writing.current = false;
      if (!scope.signal.aborted) setSaving(null);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" aria-level={2} style={candidateText.strong}>
        Statement reports
      </Text>
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={candidateText.body}>
          {loaded
            ? `Updating reports. Showing previous page ${loaded.offset / 25 + 1}`
            : 'Loading reports…'}
        </Text>
      ) : null}
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>Statement reports are unavailable</Text>
          <CandidateButton
            kind="outline"
            label="Try again"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </CandidateNotice>
      ) : null}
      <View style={{ minHeight: 200 }} aria-busy={busy}>
        {loaded?.reports.map((report) => (
          <View key={report.id} style={[candidateAccountStyles.identity, { gap: 12 }]}>
            <CandidateLink
              internal
              label={report.candidate_name ?? 'View public profile'}
              url={`/candidates/${report.candidate_id}`}
            />
            <Text style={candidateText.body}>{report.reason}</Text>
            <Text style={candidateText.body}>
              Reported {candidateDate(report.created_at.slice(0, 10))}
            </Text>
            <Text style={candidateText.strong}>Statement when reported</Text>
            <Text style={candidateText.body}>{report.statement_body}</Text>
            <ProfileClaimButton
              label="Mark report reviewed"
              busyLabel="Marking report reviewed…"
              busy={saving === report.id}
              disabled={busy || failed || Boolean(saving)}
              onPress={() => void resolve(report.id)}
            />
          </View>
        ))}
        {loaded && !loaded.reports.length ? (
          <Text style={candidateText.body}>No unresolved statement reports</Text>
        ) : null}
      </View>
      {loaded ? (
        <View style={candidateAccountStyles.actions}>
          <CandidateButton
            label="Previous reports"
            kind="outline"
            disabled={busy || failed || loaded.offset === 0}
            onPress={() => setOffset(Math.max(0, loaded.offset - 25))}
          />
          <Text style={candidateText.body}>Page {loaded.offset / 25 + 1}</Text>
          <CandidateButton
            label="Next reports"
            kind="outline"
            disabled={busy || failed || !loaded.has_more}
            onPress={() => setOffset(loaded.offset + 25)}
          />
        </View>
      ) : null}
    </View>
  );
}
export function AdminCandidateClaimsScreen({
  navigation,
  route,
}: RootScreenProps<'AdminCandidateClaims'>) {
  const { user, accessToken } = useAuth();
  const admin = useAdminAccess();
  const { openSignIn } = useSignInModal();
  const { isMobile, isDesktop } = useResponsive();
  const [denied, setDenied] = useState<string | null>(null);
  const { claimId, candidateId, fromProfile } = route.params ?? {};
  const params = new URLSearchParams();
  if (claimId) params.set('claim', claimId);
  else if (candidateId) params.set('candidate', candidateId);
  if (candidateId && fromProfile) params.set('from', 'profile');
  const returnTo = `/admin/candidate-claims${params.size ? `?${params}` : ''}`;
  const state = denied && denied === user?.id ? 'restricted' : admin.state;
  useDocumentTitle('/admin/candidate-claims', 'Profile claim requests | Alethical');
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <View
          style={{
            paddingHorizontal: isMobile ? 20 : isDesktop ? 56 : 32,
            paddingTop: 40,
            paddingBottom: 64,
          }}
        >
          <View style={{ maxWidth: 880, width: '100%', alignSelf: 'center', gap: 22 }}>
            <Text style={[candidateText.strong, { fontSize: 12, letterSpacing: 1.3 }]}>ADMIN</Text>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                { fontSize: isMobile ? 32 : 44, lineHeight: isMobile ? 39 : 51 },
              ]}
            >
              {claimId ? 'Review profile claim request' : 'Profile claim requests'}
            </Text>
            <Text style={candidateText.body}>
              Review requests for campaign access to candidate profiles. Approval lets an account
              manage its campaign statement, not official records.
            </Text>
            {state === 'allowed' && user && accessToken ? (
              claimId ? (
                <ClaimDetail
                  key={`${user.id}:${claimId}`}
                  token={accessToken}
                  id={claimId}
                  navigation={navigation}
                  onDenied={() => setDenied(user.id)}
                />
              ) : (
                <View key={`${user.id}:${candidateId ?? 'all'}`} style={{ gap: 40 }}>
                  <ClaimsQueue
                    token={accessToken}
                    candidateId={candidateId}
                    fromProfile={fromProfile}
                    navigation={navigation}
                    onDenied={() => setDenied(user.id)}
                  />
                  <ReportsQueue token={accessToken} onDenied={() => setDenied(user.id)} />
                </View>
              )
            ) : state === 'signed-out' ? (
              <>
                <Text style={candidateText.body}>
                  Sign in with an Alethical administrator account to review profile claim requests
                </Text>
                <ProfileClaimButton
                  label="Sign in"
                  kind="green"
                  onPress={() => openSignIn({ intent: 'nav', returnTo })}
                />
              </>
            ) : state === 'loading' ? (
              <Text role="status" style={candidateText.body}>
                Checking administrator access…
              </Text>
            ) : state === 'error' ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>We couldn’t check administrator access</Text>
                <ProfileClaimButton label="Try again" onPress={admin.retry} />
              </CandidateNotice>
            ) : (
              <Text style={candidateText.body}>
                This account does not have permission to review profile claim requests
              </Text>
            )}
          </View>
        </View>
        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
