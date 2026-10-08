import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CandidateDialog,
  CandidateDialogActions,
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
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../theme/fieldFocus';

type AdminNavigation = RootScreenProps<'AdminCandidateClaims'>['navigation'];
function accessDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error.status === 401 || error.status === 403),
  );
}
const adminStyles = StyleSheet.create({
  body: {
    ...candidateText.body,
    fontSize: 15.5,
    lineHeight: 22.5,
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  label: { ...candidateText.strong, fontSize: 14, lineHeight: 20, color: '#4f5651' },
  value: {
    ...candidateText.strong,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  evidence: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f1f2f4',
    borderRadius: 10,
  },
  historyBox: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f7f8fa',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 10,
    gap: 8,
  },
  historyLabel: { ...candidateText.strong, fontSize: 13.5, lineHeight: 20, color: '#4f5651' },
  historyBody: { ...candidateText.body, fontSize: 15, lineHeight: 22.5, color: '#2c322c' },
});
function ClaimContext({
  claim,
  status = true,
  variant = 'detail',
}: {
  claim: Pick<
    CandidateClaim,
    'candidate_name' | 'office' | 'voting_area' | 'election_name' | 'election_date'
  > &
    Partial<CandidateClaim>;
  status?: boolean;
  variant?: 'detail' | 'row' | 'candidate';
}) {
  const { isMobile, isDesktop } = useResponsive();
  const nameSize =
    variant === 'row' ? 17 : variant === 'candidate' ? 18 : isMobile ? 19 : isDesktop ? 22 : 21;
  const chip =
    claim.status === 'approved'
      ? { backgroundColor: '#e4f8ee', borderColor: '#8fd3ae', color: '#0b4f2c' }
      : claim.status === 'revoked'
        ? { backgroundColor: '#fdf6e7', borderColor: '#efd9a8', color: '#11150f' }
        : claim.status === 'pending'
          ? { backgroundColor: '#f1f2f4', borderColor: 'rgba(17,21,15,0.12)', color: '#11150f' }
          : { backgroundColor: '#ffffff', borderColor: 'rgba(17,21,15,0.2)', color: '#4f5651' };
  const pill = {
    ...candidateText.strong,
    fontSize: 13,
    lineHeight: 20,
    minHeight: 26,
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 999,
  };
  return (
    <View style={{ gap: 3, minWidth: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 10,
          rowGap: 6,
        }}
      >
        <Text
          accessibilityRole={variant === 'detail' ? 'header' : undefined}
          aria-level={variant === 'detail' ? 2 : undefined}
          style={[
            candidateText.strong,
            {
              fontSize: nameSize,
              lineHeight: nameSize * (variant === 'detail' ? 1.2 : 1.45),
              fontWeight: '800',
              flexShrink: 1,
            },
          ]}
        >
          {claim.candidate_name}
        </Text>
        {status && claim.status ? (
          <Text style={[pill, chip]}>{profileClaimHeadings[claim.status]}</Text>
        ) : null}
        {status && claim.election_ended ? (
          <Text
            style={[
              pill,
              { backgroundColor: '#f1f2f4', borderColor: 'rgba(17,21,15,0.1)', color: '#11150f' },
            ]}
          >
            Election ended
          </Text>
        ) : null}
      </View>
      <Text style={[adminStyles.body, variant !== 'detail' && { fontSize: 15, lineHeight: 21.75 }]}>
        {[claim.office, claim.voting_area].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[adminStyles.body, variant !== 'detail' && { fontSize: 15, lineHeight: 21.75 }]}>
        {[claim.election_name, claim.election_date && candidateDate(claim.election_date)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}
function ReviewNoteField({
  value,
  onChange,
  readOnly,
  error,
  inputRef,
}: {
  value: string;
  onChange(value: string): void;
  readOnly: boolean;
  error?: string;
  inputRef: React.Ref<TextInput>;
}) {
  const { focused, focusProps } = useFieldFocus();
  return (
    <View>
      <Text
        nativeID="profile-review-note-label"
        style={[candidateText.strong, { fontWeight: '800' }]}
      >
        Private review note
      </Text>
      <Text
        nativeID="profile-review-note-help"
        style={[adminStyles.body, { marginTop: 4, fontSize: 14.5, lineHeight: 21.75 }]}
      >
        {copy.noteHelp}
      </Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Private review note"
        aria-labelledby="profile-review-note-label"
        aria-describedby={['profile-review-note-help', error && 'profile-review-note-error']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={Boolean(error)}
        value={value}
        onChangeText={onChange}
        multiline
        editable={!readOnly}
        autoComplete="off"
        autoCapitalize="sentences"
        autoCorrect
        {...focusProps}
        style={[
          candidateAccountStyles.input,
          {
            marginTop: 10,
            minHeight: 110,
            paddingVertical: 12,
            paddingHorizontal: 14,
            lineHeight: 24.8,
            textAlignVertical: 'top',
          },
          error && { borderColor: '#a3421a' },
          fieldOutlineReset,
          ...fieldFocusRing(focused),
        ]}
      />
      {error ? (
        <Text
          nativeID="profile-review-note-error"
          role="alert"
          style={[candidateText.strong, { marginTop: 8, color: '#a3421a', fontSize: 15 }]}
        >
          {error}
        </Text>
      ) : null}
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
  const submissions = claim.history?.filter((event) =>
    ['submitted', 'resubmitted'].includes(event.kind),
  );
  return (
    <View>
      <Text
        accessibilityRole="header"
        aria-level={3}
        style={[candidateText.strong, { fontSize: 18, fontWeight: '800' }]}
      >
        Profile claim history
      </Text>
      <View style={{ marginTop: 12 }}>
        {claim.history?.map((event, index) => {
          const prior = event.candidate;
          const changedContext =
            prior &&
            ['candidate_name', 'office', 'voting_area', 'election_name', 'election_date'].some(
              (key) => prior[key as keyof typeof prior] !== claim[key as keyof CandidateClaim],
            );
          return (
            <View
              key={event.id}
              style={[{ paddingVertical: 12, gap: 3 }, index > 0 && adminStyles.divider]}
            >
              <Text style={[candidateText.strong, { fontSize: 15.5, fontWeight: '800' }]}>
                {eventNames[event.kind]}
              </Text>
              <Text style={[adminStyles.body, { fontSize: 14.5 }]}>
                {[profileClaimTime(event.created_at), event.actor_name].filter(Boolean).join(' · ')}
              </Text>
              {changedContext ? (
                <View style={{ marginTop: 5 }}>
                  <Text style={adminStyles.historyBody}>
                    {[prior.candidate_name, prior.office, prior.voting_area]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={adminStyles.historyBody}>
                    {[
                      prior.election_name,
                      prior.election_date && candidateDate(prior.election_date),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              ) : null}
              {(event.evidence_url || event.request_note) &&
              (['submitted', 'resubmitted'].includes(event.kind) ||
                !submissions?.some(
                  (submission) =>
                    submission.evidence_url === event.evidence_url &&
                    submission.request_note === event.request_note,
                )) ? (
                <View style={adminStyles.historyBox}>
                  {event.evidence_url ? (
                    <View style={{ gap: 3 }}>
                      <Text style={adminStyles.historyLabel}>{copy.link}</Text>
                      <CandidateLink label={event.evidence_url} url={event.evidence_url} />
                    </View>
                  ) : null}
                  {event.request_note ? (
                    <View style={{ gap: 3 }}>
                      <Text style={adminStyles.historyLabel}>{copy.explanation}</Text>
                      <Text style={adminStyles.historyBody}>{event.request_note}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {event.review_note ? (
                <View style={adminStyles.historyBox}>
                  <Text style={adminStyles.historyLabel}>Private review note</Text>
                  <Text style={adminStyles.historyBody}>{event.review_note}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {!claim.history?.length && claim.review_note ? (
        <View style={adminStyles.historyBox}>
          <Text style={adminStyles.historyLabel}>Private review note</Text>
          <Text style={adminStyles.historyBody}>{claim.review_note}</Text>
        </View>
      ) : null}
      {!claim.history_complete ? (
        <Text
          style={[
            adminStyles.body,
            adminStyles.divider,
            { marginTop: 4, paddingTop: 12, fontSize: 15 },
          ]}
        >
          Earlier profile claim history is unavailable
        </Text>
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
  const { isMobile, isDesktop } = useResponsive();
  const cardPadding = {
    paddingVertical: isMobile ? 18 : isDesktop ? 22 : 20,
    paddingHorizontal: isMobile ? 16 : isDesktop ? 26 : 22,
  };
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
      <View
        role="article"
        aria-label={`Profile claim request for ${claim.candidate_name}`}
        style={{
          backgroundColor: '#ffffff',
          borderWidth: 1,
          borderColor: 'rgba(17,21,15,0.1)',
          borderRadius: 16,
        }}
      >
        <View style={[cardPadding, { gap: 3 }]}>
          <ClaimContext claim={claim} />
          <CandidateLink
            internal
            label="View public profile"
            url={`/candidates/${claim.candidate_id}`}
            onPress={() =>
              navigation.navigate('CandidateProfile', { candidateId: claim.candidate_id })
            }
          />
        </View>
        <View style={[cardPadding, adminStyles.divider, { gap: 16 }]}>
          <View style={{ flexDirection: isMobile ? 'column' : 'row', columnGap: 24, rowGap: 16 }}>
            <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <Text style={adminStyles.label}>Applicant email</Text>
              <Text style={adminStyles.value}>
                {claim.account_email ?? 'No confirmed account email available'}
              </Text>
              {claim.account_email ? (
                <Text style={[adminStyles.body, { fontSize: 14 }]}>Confirmed account address</Text>
              ) : null}
            </View>
            <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <Text style={adminStyles.label}>Submitted</Text>
              <Text style={adminStyles.value}>
                {profileClaimTime(claim.submitted_at ?? claim.created_at)}
              </Text>
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={adminStyles.label}>{copy.link}</Text>
            <CandidateLink label={claim.evidence_url} url={claim.evidence_url} />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={adminStyles.label}>{copy.explanation}</Text>
            <View style={adminStyles.evidence}>
              <Text style={[adminStyles.body, { lineHeight: 24, color: '#2c322c' }]}>
                {claim.request_note}
              </Text>
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={adminStyles.label}>Official candidate record</Text>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 6 }}
            >
              {safeCandidateUrl(claim.official_source?.url ?? '') ? (
                <CandidateLink
                  label={claim.official_source?.authority ?? 'Official candidate record'}
                  url={claim.official_source!.url!}
                />
              ) : (
                <Text style={adminStyles.body}>Official source unavailable</Text>
              )}
              {claim.official_checked_at ? (
                <Text style={adminStyles.value}>
                  · Checked {profileClaimTime(claim.official_checked_at)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <View aria-label="Decision" style={[cardPadding, adminStyles.divider, { gap: 16 }]}>
          {loading || notice ? (
            <Text role="status" style={[candidateText.strong, { color: '#0b4f2c' }]}>
              {loading ? 'Loading profile claim request…' : notice}
            </Text>
          ) : null}
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
          {(claim.status === 'pending' || claim.status === 'approved') &&
          !failure &&
          !ownRequest ? (
            <View style={{ gap: 16 }}>
              {block && claim.status === 'pending' ? (
                <CandidateNotice error>
                  <Text nativeID="profile-approval-block" style={candidateText.body}>
                    {blocks[block.reason] ?? block.message}
                  </Text>
                  {['official_record_stale', 'official_record_mismatch'].includes(block.reason) ? (
                    <ProfileClaimButton
                      label="Recheck official record"
                      busyLabel="Rechecking official record…"
                      busy={busy === 'recheck'}
                      width={isMobile ? '100%' : 270}
                      disabled={disabled}
                      onPress={() => void recheck()}
                    />
                  ) : null}
                </CandidateNotice>
              ) : null}
              {recheckFailed ? (
                <Text role="alert" style={[candidateText.strong, { color: '#a3421a' }]}>
                  We couldn’t refresh the official candidate record. Approval remains unavailable;
                  try again.
                </Text>
              ) : null}
              <ReviewNoteField
                value={note}
                onChange={setNote}
                readOnly={disabled}
                error={noteError}
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
                      fontSize: 15.5,
                      lineHeight: '22.5px',
                      fontWeight: 600,
                      minHeight: 44,
                      padding: '12px 14px',
                      backgroundColor: '#f7f8fa',
                      border: `1px solid ${checkError ? '#a3421a' : 'rgba(17,21,15,0.16)'}`,
                      borderRadius: 12,
                      cursor: disabled ? 'not-allowed' : 'pointer',
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
                        margin: '1px 0 0',
                        flexShrink: 0,
                        width: 20,
                        height: 20,
                        accentColor: '#0f7a45',
                      }}
                    />
                    I independently verified this applicant’s identity and authority to represent
                    this campaign
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
                  { marginTop: 2, columnGap: 12, rowGap: 10 },
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
                    width={isMobile ? '100%' : 250}
                    onPress={() => {
                      if (validate('revoke')) setDialog(true);
                    }}
                  />
                )}
              </View>
            </View>
          ) : null}
        </View>
        <View style={[cardPadding, adminStyles.divider]}>
          <ClaimHistory claim={claim} />
        </View>
      </View>
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
          <CandidateDialogActions>
            <ProfileClaimButton
              label="Keep profile claim"
              kind="green"
              disabled={Boolean(busy)}
              width={isMobile ? '100%' : undefined}
              onPress={() => setDialog(false)}
            />
            <ProfileClaimButton
              label="Revoke profile claim"
              busyLabel="Revoking profile claim…"
              busy={busy === 'revoke'}
              kind="danger"
              width={isMobile ? '100%' : 250}
              onPress={() => void act('revoke')}
            />
          </CandidateDialogActions>
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
  const { isMobile, isDesktop } = useResponsive();
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
      {candidateId && loaded?.result.candidate ? (
        <View
          style={{
            paddingVertical: 14,
            paddingHorizontal: 18,
            backgroundColor: '#ffffff',
            borderWidth: 1,
            borderColor: 'rgba(17,21,15,0.1)',
            borderRadius: 14,
          }}
        >
          <ClaimContext claim={loaded.result.candidate} status={false} variant="candidate" />
        </View>
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
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                gap: 3,
                padding: 3,
                borderWidth: 1,
                borderColor: 'rgba(17,21,15,0.1)',
                backgroundColor: '#f1f2f4',
                borderRadius: 12,
              }}
            >
              {(['pending', 'all'] as const).map((value) => (
                <ProfileClaimButton
                  key={value}
                  label={value === 'pending' ? 'Pending' : 'All'}
                  selected={request.filter === value}
                  width={isMobile ? 'calc(50% - 1.5px)' : 112}
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
            style={{ minHeight: 220, opacity: busy && loaded ? 0.6 : 1, gap: 10 }}
          >
            {loaded?.result.claims.map((claim) => (
              <View
                key={claim.id}
                style={{
                  paddingTop: isMobile ? 16 : 18,
                  paddingBottom: isMobile ? 10 : 18,
                  paddingHorizontal: isMobile ? 16 : isDesktop ? 22 : 20,
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: 'rgba(17,21,15,0.1)',
                  borderRadius: 14,
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'flex-start' : 'center',
                  justifyContent: 'space-between',
                  rowGap: 12,
                  columnGap: 20,
                }}
              >
                <View style={{ minWidth: 0, flex: isMobile ? undefined : 1, gap: 3 }}>
                  <ClaimContext claim={claim} variant="row" />
                  <Text style={[adminStyles.body, { fontSize: 15, lineHeight: 21.75 }]}>
                    {claim.account_email ?? 'No confirmed account email available'} · Submitted{' '}
                    {profileClaimTime(claim.submitted_at ?? claim.created_at)}
                  </Text>
                </View>
                <CandidateLink
                  internal
                  label="Review profile claim request"
                  accessibilityLabel={`Review profile claim request for ${claim.candidate_name}`}
                  url={`/admin/candidate-claims?${new URLSearchParams({
                    claim: claim.id,
                    ...(candidateId ? { candidate: candidateId } : {}),
                    ...(candidateId && fromProfile ? { from: 'profile' } : {}),
                  })}`}
                  style={{ flexShrink: 0, alignSelf: isMobile ? 'flex-start' : 'center' }}
                  onPress={() =>
                    navigation.navigate('AdminCandidateClaims', {
                      claimId: claim.id,
                      ...(candidateId ? { candidateId } : {}),
                      ...(candidateId && fromProfile ? { fromProfile: true } : {}),
                    })
                  }
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
  const { isMobile, isDesktop } = useResponsive();
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
    <View
      style={{
        gap: 14,
        marginTop: 4,
        paddingTop: 26,
        borderTopWidth: 1,
        borderTopColor: 'rgba(17,21,15,0.12)',
      }}
    >
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[
          candidateText.strong,
          { fontSize: isMobile ? 19 : isDesktop ? 22 : 21, fontWeight: '800' },
        ]}
      >
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
      <View style={{ minHeight: 200, gap: 10 }} aria-busy={busy}>
        {loaded?.reports.map((report) => (
          <View
            key={report.id}
            style={{
              paddingTop: isMobile ? 16 : 18,
              paddingBottom: isMobile ? 10 : 18,
              paddingHorizontal: isMobile ? 16 : isDesktop ? 22 : 20,
              backgroundColor: '#ffffff',
              borderWidth: 1,
              borderColor: 'rgba(17,21,15,0.1)',
              borderRadius: 14,
              gap: 12,
            }}
          >
            <CandidateLink
              internal
              label={report.candidate_name ?? 'View public profile'}
              url={`/candidates/${report.candidate_id}`}
            />
            <View style={{ gap: 4 }}>
              <Text style={adminStyles.label}>Report reason</Text>
              <Text style={adminStyles.body}>{report.reason}</Text>
            </View>
            <Text style={candidateText.body}>
              Reported {candidateDate(report.created_at.slice(0, 10))}
            </Text>
            <View style={{ gap: 6 }}>
              <Text style={adminStyles.label}>Statement when reported</Text>
              <View style={adminStyles.evidence}>
                <Text style={[adminStyles.body, { color: '#2c322c', lineHeight: 24 }]}>
                  {report.statement_body}
                </Text>
              </View>
            </View>
            <ProfileClaimButton
              label="Mark report reviewed"
              width={isMobile ? '100%' : 260}
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
  if (candidateId) params.set('candidate', candidateId);
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
            paddingTop: isMobile ? 18 : isDesktop ? 26 : 24,
            paddingBottom: 56,
          }}
        >
          <View
            style={{ maxWidth: isDesktop ? 960 : 836, width: '100%', alignSelf: 'center', gap: 24 }}
          >
            <View>
              {state === 'allowed' && (claimId || candidateId) ? (
                <View
                  role="navigation"
                  aria-label="Profile claim navigation"
                  style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 4 }}
                >
                  {candidateId && fromProfile ? (
                    <CandidateLink
                      internal
                      label="Back to candidate profile"
                      url={`/candidates/${candidateId}`}
                      onPress={() => navigation.navigate('CandidateProfile', { candidateId })}
                    />
                  ) : null}
                  <CandidateLink
                    internal
                    label="View all profile claim requests"
                    url="/admin/candidate-claims"
                    onPress={() => navigation.navigate('AdminCandidateClaims', {})}
                  />
                </View>
              ) : null}
              <View style={{ gap: 12, marginTop: 10 }}>
                <Text
                  style={[
                    candidateText.strong,
                    { fontSize: 13, lineHeight: 19, letterSpacing: 2.6, color: '#0f7a45' },
                  ]}
                >
                  ADMIN
                </Text>
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  style={[
                    candidateText.title,
                    {
                      fontSize: isMobile ? 30 : isDesktop ? 40 : 36,
                      lineHeight: (isMobile ? 30 : isDesktop ? 40 : 36) * 1.08,
                      letterSpacing: (isMobile ? 30 : isDesktop ? 40 : 36) * -0.02,
                    },
                  ]}
                >
                  Profile claim requests
                </Text>
                {state === 'allowed' ? (
                  <Text
                    style={[
                      candidateText.body,
                      {
                        fontSize: isMobile ? 16 : isDesktop ? 18 : 17,
                        lineHeight: (isMobile ? 16 : isDesktop ? 18 : 17) * 1.5,
                        color: '#2c322c',
                        maxWidth: 760,
                      },
                    ]}
                  >
                    Review requests for campaign access to candidate profiles. Approval lets an
                    account manage its campaign statement, not official records.
                  </Text>
                ) : null}
              </View>
            </View>
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
