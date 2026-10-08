import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import {
  CandidateAccountIdentity,
  CandidateField,
  CandidateDialog,
  CandidateStatusHeading,
  CandidateRecordBoundary,
  CandidateDialogActions,
  CandidateStatusIcon,
  candidateAccountStyles,
} from '../components/candidates/CandidateAccountControls';
import { CandidateCampaignStatement } from '../components/candidates/CandidateClaimPanel';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
} from '../components/candidates/CandidateControls';
import type { CandidateProfileRecord } from '../components/candidates/types';
import { getCandidateProfile } from '../data/candidates';
import { isNotFoundError } from '../data/api';
import {
  getMyCandidateClaims,
  getPrivateCandidateStatement,
  requestCandidateClaim,
  withdrawCandidateClaim,
  saveCandidateStatement,
  removeCandidateStatement,
  profileClaimsChanged,
  type CandidateClaim,
  type CandidateClaimList,
  type PrivateCandidateStatement,
} from '../data/candidateClaims';
import { ProfileClaimButton } from '../components/candidates/ProfileClaimButton';
import {
  profileClaimCopy as copy,
  profileClaimHeadings,
  profileClaimFormErrors,
  profileClaimErrorReason,
  claimAccountBlock,
} from '../components/candidates/profileClaimCopy';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { useResponsive } from '../hooks/useResponsive';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { NotFoundScreen } from './redesign/NotFoundScreen';

function AccountIntro({
  mode,
  record,
  onPublic,
}: {
  mode: 'claim' | 'manage';
  record: CandidateProfileRecord;
  onPublic(): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const size = isMobile ? 30 : isDesktop ? 40 : 36;
  return (
    <>
      <CandidateLink
        internal
        direction="back"
        url={`/candidates/${record.candidate.id}`}
        label="View public profile"
        onPress={onPublic}
      />
      <Text
        accessibilityRole="header"
        aria-level={1}
        style={[candidateText.title, { marginTop: 10, fontSize: size, lineHeight: size * 1.08 }]}
      >
        {mode === 'claim' ? 'Claim this profile' : 'Manage this profile'}
      </Text>
      <Text
        style={[
          candidateText.body,
          {
            marginTop: 12,
            fontSize: isMobile ? 16 : isDesktop ? 18 : 17,
            lineHeight: isMobile ? 24 : isDesktop ? 27 : 25.5,
            color: '#2c322c',
          },
        ]}
      >
        {mode === 'claim' ? copy.claim : copy.manage}
      </Text>
      {mode === 'claim' ? (
        <View style={{ marginTop: 12 }}>
          <CandidateRecordBoundary>
            An approved profile claim lets you manage the campaign statement, not the official
            record
          </CandidateRecordBoundary>
        </View>
      ) : null}
    </>
  );
}
function useRequestLifetime() {
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  return () => lifetime.current.signal;
}
function SavedEvidence({
  claim,
}: {
  claim: Pick<CandidateClaim, 'evidence_url' | 'request_note'>;
}) {
  return (
    <View
      style={[
        candidateAccountStyles.identity,
        {
          marginTop: 22,
          paddingVertical: 16,
          borderRadius: 12,
          backgroundColor: '#f1f2f4',
          gap: 14,
        },
      ]}
    >
      <View>
        <Text style={[candidateText.strong, { fontSize: 14, color: '#4f5651' }]}>{copy.link}</Text>
        <CandidateLink label={claim.evidence_url} url={claim.evidence_url} />
      </View>
      <View>
        <Text style={[candidateText.strong, { fontSize: 14, color: '#4f5651' }]}>
          {copy.explanation}
        </Text>
        <Text style={[candidateText.body, { marginTop: 4, fontSize: 15.5, color: '#2c322c' }]}>
          {claim.request_note}
        </Text>
      </View>
    </View>
  );
}
function ClaimForm({
  record,
  token,
  onManage,
  onAdmin,
  onPublic,
}: {
  record: CandidateProfileRecord;
  token: string;
  onManage(): void;
  onAdmin(): void;
  onPublic(): void;
}) {
  const signal = useRequestLifetime();
  const { isMobile, isDesktop } = useResponsive();
  const [response, setResponse] = useState<CandidateClaimList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'submit' | 'withdraw' | null>(null);
  const writing = useRef(false);
  const [unknown, setUnknown] = useState<'submit' | 'withdraw' | null>(null);
  const [knownError, setKnownError] = useState('');
  const [already, setAlready] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [role, setRole] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<ReturnType<typeof profileClaimFormErrors>>({});
  const roles = useRef<HTMLFieldSetElement>(null);
  const linkRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);
  const statusRef = useRef<View>(null);
  const current = response?.claims.find((item) => item.candidate_id === record.candidate.id);
  const reason = response?.request_eligibility?.reason;
  const closed =
    current?.election_ended ?? (reason === 'election_ended' || record.electionEnded === true);
  const canRequest = response?.request_eligibility?.allowed === true;
  const load = async () => {
    const scope = signal();
    setLoading(true);
    setFailed(false);
    try {
      const next = await getMyCandidateClaims(token, record.candidate.id, scope);
      if (!scope.aborted) {
        setResponse(next);
        if (!next.request_eligibility?.allowed) setFormOpen(false);
        setUnknown(null);
        setKnownError('');
      }
    } catch {
      if (!scope.aborted) setFailed(true);
    } finally {
      if (!scope.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!loading && (current || already))
      (statusRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [loading, current?.status, already]);
  const submit = async () => {
    if (writing.current || !response || !canRequest || unknown) return;
    const invalid = profileClaimFormErrors(role, evidence, note);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      if (invalid.role) roles.current?.focus();
      else if (invalid.link) linkRef.current?.focus();
      else noteRef.current?.focus();
      return;
    }
    const scope = signal();
    writing.current = true;
    setBusy('submit');
    setKnownError('');
    try {
      const saved = await requestCandidateClaim(
        token,
        {
          candidate_id: record.candidate.id,
          evidence_url: evidence.trim(),
          request_note: `${role}\n\n${note.trim()}`,
          expected_account_id: response.account_id,
          expected_version: current?.version ?? 0,
        },
        scope,
      );
      if (!scope.aborted) {
        setFormOpen(false);
        setAlready(saved.already_submitted === true);
        profileClaimsChanged();
        await load();
      }
    } catch (error) {
      if (!scope.aborted) {
        const why = profileClaimErrorReason(error);
        if (why === 'evidence_url_invalid')
          setErrors({ link: 'Enter a valid public campaign or official-record web address' });
        else if (why === 'evidence_url_required')
          setErrors({ link: 'Add a link to a campaign website or official record' });
        else if (why === 'evidence_url_too_long')
          setErrors({ link: 'Use a web address with no more than 2000 characters' });
        else if (why === 'role_required') setErrors({ role: 'Choose your role' });
        else if (why === 'explanation_too_short')
          setErrors({
            explanation:
              'Explain your role and how Alethical can confirm it in at least 20 characters',
          });
        else if (why === 'explanation_too_long')
          setErrors({ explanation: 'Keep your explanation to 1900 characters or fewer' });
        else if (
          why === 'election_ended' ||
          why === 'profile_claim_changed' ||
          why === 'profile_claim_approved' ||
          why === 'profile_claim_pending'
        )
          await load();
        else if (claimAccountBlock(why)) {
          setKnownError(claimAccountBlock(why)!);
          await load();
        } else {
          setUnknown('submit');
        }
      }
    } finally {
      writing.current = false;
      if (!scope.aborted) setBusy(null);
    }
  };
  const withdraw = async () => {
    if (writing.current || !response || !current || current.status !== 'pending' || unknown) return;
    const scope = signal();
    writing.current = true;
    setBusy('withdraw');
    try {
      await withdrawCandidateClaim(
        token,
        current.id,
        { expected_account_id: response.account_id, expected_version: current.version },
        scope,
      );
      if (!scope.aborted) {
        setAlready(false);
        profileClaimsChanged();
        await load();
      }
    } catch {
      if (!scope.aborted) setUnknown('withdraw');
    } finally {
      writing.current = false;
      if (!scope.aborted) setBusy(null);
    }
  };
  const heading = already
    ? 'Profile claim request already submitted'
    : current?.status === 'pending' && closed
      ? 'Election ended'
      : current
        ? profileClaimHeadings[current.status]
        : '';
  const body = already
    ? 'You already have a profile claim request for this candidate profile'
    : current?.status === 'pending' && closed
      ? copy.ended
      : current
        ? copy[current.status]
        : '';
  const admin = response?.is_admin === true;
  const block = claimAccountBlock(reason);
  const publicLink = (
    <CandidateLink
      internal
      url={`/candidates/${record.candidate.id}`}
      label="View public profile"
      onPress={onPublic}
    />
  );
  const frame = (content: ReactNode, form = false, showReturn = true) => (
    <>
      {form ? <AccountIntro mode="claim" record={record} onPublic={onPublic} /> : null}
      <CandidateAccountIdentity record={record} />
      <View style={{ marginTop: 26 }}>{content}</View>
      {!form && showReturn ? <View style={{ marginTop: 14 }}>{publicLink}</View> : null}
    </>
  );
  if (loading)
    return frame(
      <Text role="status" style={candidateText.body}>
        {copy.loading}
      </Text>,
    );
  if (failed)
    return frame(
      <CandidateNotice error>
        <Text style={candidateText.strong}>{copy.failed}</Text>
        <ProfileClaimButton label="Try again" onPress={() => void load()} />
      </CandidateNotice>,
    );
  if (admin || (block && !current))
    return frame(
      <View style={{ gap: 16 }}>
        <CandidateStatusHeading
          title={admin ? copy.adminBlock : block!}
          kind={admin ? 'admin' : 'warning'}
        />
        {admin ? (
          <CandidateButton
            label="Review profile claim requests"
            icon="none"
            kind="outline"
            onPress={onAdmin}
          />
        ) : null}
      </View>,
    );
  if (current && !formOpen)
    return frame(
      <View>
        <CandidateStatusHeading
          headingRef={statusRef}
          title={heading}
          body={body}
          kind={
            current.status === 'approved'
              ? 'approved'
              : current.status === 'pending'
                ? 'pending'
                : current.status === 'withdrawn'
                  ? 'withdrawn'
                  : 'warning'
          }
        />
        {block && current.status !== 'approved' ? (
          <Text style={candidateText.body}>{block}</Text>
        ) : null}
        {current.status === 'pending' ? <SavedEvidence claim={current} /> : null}
        {unknown ? (
          <CandidateNotice error>
            <Text style={candidateText.body}>
              {unknown === 'withdraw' ? copy.withdrawUnknown : copy.submitUnknown}
            </Text>
            <ProfileClaimButton label="Reload profile claim status" onPress={() => void load()} />
          </CandidateNotice>
        ) : (
          <View
            style={{
              marginTop: 22,
              gap: 10,
              flexDirection: isMobile ? 'column' : 'row',
              flexWrap: 'wrap',
              alignItems: isMobile ? 'stretch' : 'center',
            }}
          >
            {already ? (
              <ProfileClaimButton
                label="View profile claim status"
                onPress={() => setAlready(false)}
              />
            ) : current.status === 'pending' ? (
              <ProfileClaimButton
                label="Withdraw profile claim request"
                busyLabel="Withdrawing profile claim request…"
                busy={busy === 'withdraw'}
                width={isMobile ? '100%' : 372}
                onPress={() => void withdraw()}
              />
            ) : current.status === 'approved' && current.can_manage ? (
              <CandidateButton
                label="Manage this profile"
                icon="none"
                href={`/candidates/${record.candidate.id}/manage`}
                onPress={onManage}
              />
            ) : current.can_request_review && canRequest ? (
              <ProfileClaimButton
                label="Request a profile claim review"
                onPress={() => setFormOpen(true)}
              />
            ) : null}
            {publicLink}
          </View>
        )}
      </View>,
      false,
      Boolean(unknown),
    );
  if (closed)
    return frame(
      <View style={{ gap: 8 }}>
        <Text style={candidateText.strong}>{copy.closedTitle}</Text>
        <Text style={candidateText.body}>{copy.closed}</Text>
      </View>,
      true,
    );
  if (response?.already_claimed && !formOpen)
    return frame(
      <View style={{ gap: 14 }}>
        <CandidateStatusHeading
          title="This profile is already claimed"
          body={copy.taken}
          kind="warning"
        />
        {canRequest ? (
          <ProfileClaimButton
            label="Request a profile claim review"
            onPress={() => setFormOpen(true)}
          />
        ) : null}
      </View>,
    );
  return frame(
    <View>
      <fieldset
        ref={roles}
        tabIndex={-1}
        aria-describedby={errors.role ? 'profile-role-error' : undefined}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <legend
          style={{ fontFamily: candidateText.body.fontFamily, fontSize: 17, fontWeight: 800 }}
        >
          Your role
        </legend>
        <View style={{ gap: 8, marginTop: 10, flexDirection: isMobile ? 'column' : 'row' }}>
          {['Candidate', 'Authorized campaign representative'].map((label) => (
            <label
              key={label}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 54,
                boxSizing: 'border-box',
                padding: '12px 14px',
                border: `1px solid ${errors.role ? '#a3421a' : role === label ? '#2ed47e' : 'rgba(17,21,15,.16)'}`,
                background: role === label ? '#f2fbf6' : '#fff',
                borderRadius: 12,
                fontFamily: candidateText.body.fontFamily,
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              <input
                type="radio"
                className="profile-claim-input"
                name="profile-claim-role"
                checked={role === label}
                disabled={Boolean(busy) || Boolean(unknown)}
                aria-invalid={Boolean(errors.role)}
                onChange={() => setRole(label)}
                style={{ width: 20, height: 20, accentColor: '#0f7a45', flexShrink: 0 }}
              />
              {label}
            </label>
          ))}
        </View>
        {errors.role ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
            <CandidateStatusIcon kind="warning" size={17} />
            <Text
              nativeID="profile-role-error"
              role="alert"
              style={[candidateText.strong, { color: '#a3421a' }]}
            >
              {errors.role}
            </Text>
          </View>
        ) : null}
      </fieldset>
      <View style={{ gap: 6, marginTop: 30 }}>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[
            candidateText.title,
            { fontSize: isMobile ? 19 : isDesktop ? 21 : 20, lineHeight: 28 },
          ]}
        >
          Profile claim review
        </Text>
        <Text style={candidateText.body}>
          A filing record or certificate supports your profile claim request but does not prove your
          identity or authority to represent the campaign
        </Text>
      </View>
      <View style={{ marginTop: 18 }}>
        <CandidateField
          label={copy.link}
          value={evidence}
          onChange={setEvidence}
          error={errors.link}
          inputRef={linkRef}
          readOnly={Boolean(busy) || Boolean(unknown)}
          inputStyle={{ minHeight: 52, paddingHorizontal: 14, paddingVertical: 12 }}
        />
      </View>
      <View style={{ marginTop: 20 }}>
        <CandidateField
          label={copy.explanation}
          value={note}
          onChange={setNote}
          error={errors.explanation}
          inputRef={noteRef}
          multiline
          readOnly={Boolean(busy) || Boolean(unknown)}
          inputStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
        />
      </View>
      {knownError ? (
        <Text role="alert" style={candidateText.strong}>
          {knownError}
        </Text>
      ) : null}
      <View style={{ marginTop: 24 }}>
        {unknown ? (
          <CandidateNotice error>
            <Text style={candidateText.body}>{copy.submitUnknown}</Text>
            <ProfileClaimButton label="Reload profile claim status" onPress={() => void load()} />
          </CandidateNotice>
        ) : (
          <ProfileClaimButton
            label="Submit profile claim request"
            busyLabel="Submitting profile claim request…"
            kind="green"
            width={isMobile ? '100%' : 380}
            busy={busy === 'submit'}
            disabled={!canRequest}
            onPress={() => void submit()}
          />
        )}
      </View>
    </View>,
    true,
  );
}
function ManageContent({
  record,
  token,
  navigation,
}: {
  record: CandidateProfileRecord;
  token: string;
  navigation: RootScreenProps<'CandidateManage'>['navigation'];
}) {
  const signal = useRequestLifetime();
  const { isMobile } = useResponsive();
  const [claims, setClaims] = useState<CandidateClaimList | null>(null);
  const [loaded, setLoaded] = useState<PrivateCandidateStatement | null>(null);
  const [draft, setDraft] = useState('');
  const initialised = useRef(false);
  const writing = useRef(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'withdraw' | null>(null);
  const [failure, setFailure] = useState<'load' | 'write' | 'give' | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [givenUp, setGivenUp] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<'remove' | 'leave' | 'withdraw' | null>(null);
  const [leaveAction, setLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const claim = claims?.claims.find((item) => item.candidate_id === record.candidate.id);
  const canManage = claims?.is_admin !== true && claim?.can_manage === true;
  const publicBody = loaded?.statement?.body ?? '';
  const dirty = canManage && initialised.current && draft !== publicBody && !givenUp;
  const load = async (recover = false) => {
    const scope = signal();
    setLoading(true);
    try {
      const mine = await getMyCandidateClaims(token, record.candidate.id, scope);
      if (scope.aborted) return;
      const access = mine.claims.find((item) => item.candidate_id === record.candidate.id);
      const statement =
        mine.is_admin !== true && access?.can_manage
          ? await getPrivateCandidateStatement(token, access.id, scope)
          : null;
      if (!scope.aborted) {
        setClaims(mine);
        setLoaded(statement);
        setFailure(null);
        setDialog(null);
        if (!statement) {
          setDraft('');
          initialised.current = false;
          setPreview(false);
        } else if (!initialised.current) {
          setDraft(statement.statement?.body ?? '');
          initialised.current = true;
        }
        if (recover && statement) setRecovered(true);
        if (access?.last_event_kind === 'given_up') {
          setGivenUp(true);
          setMessage(
            `${copy.givenUp}${access.statement_removed ? ' Your published campaign statement was removed.' : ''}`,
          );
        }
      }
    } catch (error) {
      if (!scope.aborted) {
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
          setLoaded(null);
          setDraft('');
          setClaims(null);
          initialised.current = false;
          setPreview(false);
          setDialog(null);
        }
        setFailure('load');
      }
    } finally {
      if (!scope.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  usePreventRemove(dirty && !discarding, ({ data }) => {
    setLeaveAction(data.action);
    setDialog('leave');
  });
  useEffect(() => {
    if (discarding && leaveAction) navigation.dispatch(leaveAction);
  }, [discarding, leaveAction, navigation]);
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const write = async (action: 'save' | 'remove' | 'withdraw') => {
    if (!claim || !claims || !canManage || writing.current || failure) return;
    const scope = signal();
    writing.current = true;
    setBusy(action);
    setMessage('');
    try {
      if (action === 'withdraw') {
        const result = await withdrawCandidateClaim(
          token,
          claim.id,
          { expected_account_id: claims.account_id, expected_version: claim.version },
          scope,
        );
        if (!scope.aborted) {
          setGivenUp(true);
          setDraft('');
          setLoaded(null);
          initialised.current = false;
          setPreview(false);
          setClaims({
            ...claims,
            claims: claims.claims.map((item) => (item.id === claim.id ? result.claim : item)),
          });
          setMessage(
            `${copy.givenUp}${result.claim.statement_removed ? ' Your published campaign statement was removed.' : ''}`,
          );
          setDialog(null);
          profileClaimsChanged();
        }
      } else {
        const identity = {
          expected_account_id: claims.account_id,
          expected_version: loaded?.statement?.version ?? 0,
        };
        if (action === 'remove') await removeCandidateStatement(token, claim.id, identity, scope);
        else await saveCandidateStatement(token, claim.id, { ...identity, body: draft }, scope);
        const next = await getPrivateCandidateStatement(token, claim.id, scope);
        if (!scope.aborted) {
          setLoaded(next);
          setDraft(next.statement?.body ?? '');
          setDialog(null);
          setRecovered(false);
          setMessage(
            action === 'remove'
              ? 'Statement removed'
              : publicBody
                ? 'Changes saved'
                : 'Statement published',
          );
        }
      }
    } catch (error) {
      if (!scope.aborted) {
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
          setLoaded(null);
          setDraft('');
          setClaims(null);
          initialised.current = false;
          setPreview(false);
        }
        setFailure(action === 'withdraw' ? 'give' : 'write');
        setDialog(null);
      }
    } finally {
      writing.current = false;
      if (!scope.aborted) setBusy(null);
    }
  };
  const goClaim = () => navigation.navigate('CandidateClaim', { candidateId: record.candidate.id });
  const onPublic = () =>
    navigation.navigate('CandidateProfile', { candidateId: record.candidate.id });
  const publicLink = (
    <CandidateLink
      internal
      url={`/candidates/${record.candidate.id}`}
      label="View public profile"
      onPress={onPublic}
    />
  );
  const returnLink = (
    <CandidateLink
      internal
      direction="back"
      url={`/candidates/${record.candidate.id}`}
      label="View public profile"
      onPress={onPublic}
    />
  );
  if (givenUp)
    return (
      <>
        {returnLink}
        <View
          role="status"
          style={{
            marginTop: 14,
            paddingVertical: 16,
            paddingHorizontal: 18,
            borderWidth: 1,
            borderColor: '#bfeacf',
            backgroundColor: '#e4f8ee',
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <CandidateStatusIcon kind="success" size={19} />
          <Text style={[candidateText.body, { color: '#0b4f2c', fontWeight: '600', flex: 1 }]}>
            {message}
          </Text>
        </View>
        <CandidateAccountIdentity record={record} />
      </>
    );
  if (!claims && loading)
    return (
      <>
        {returnLink}
        <CandidateAccountIdentity record={record} />
        <Text role="status" style={[candidateText.body, { marginTop: 26 }]}>
          {copy.loading}
        </Text>
      </>
    );
  if (!claims && failure)
    return (
      <>
        {returnLink}
        <CandidateAccountIdentity record={record} />
        <View style={{ marginTop: 26 }}>
          <CandidateNotice error>
            <Text style={candidateText.strong}>{copy.failed}</Text>
            <ProfileClaimButton label="Try again" onPress={() => void load()} />
          </CandidateNotice>
        </View>
      </>
    );
  if (claims?.is_admin)
    return (
      <>
        {returnLink}
        <View style={{ marginTop: 26 }}>
          <CandidateStatusHeading title={copy.adminBlock} kind="admin" />
        </View>
        <CandidateAccountIdentity record={record} />
        <View style={{ marginTop: 22 }}>
          <CandidateButton
            label="Review profile claim requests"
            kind="outline"
            icon="none"
            onPress={() =>
              navigation.navigate('AdminCandidateClaims', { candidateId: record.candidate.id })
            }
          />
        </View>
      </>
    );
  if (!canManage)
    return (
      <>
        {returnLink}
        <View style={{ marginTop: 26 }}>
          <CandidateStatusHeading
            title={claim ? profileClaimHeadings[claim.status] : 'Profile claim required'}
            body={
              claimAccountBlock(claims?.request_eligibility?.reason) ??
              (claim ? copy[claim.status] : copy.claim)
            }
            kind={
              claim?.status === 'pending'
                ? 'pending'
                : claim?.status === 'withdrawn'
                  ? 'withdrawn'
                  : 'warning'
            }
          />
        </View>
        <CandidateAccountIdentity record={record} />
        <View
          style={{
            marginTop: 22,
            gap: 10,
            flexDirection: isMobile ? 'column' : 'row',
            flexWrap: 'wrap',
            alignItems: isMobile ? 'stretch' : 'center',
          }}
        >
          {claim?.can_request_review && claims?.request_eligibility?.allowed ? (
            <ProfileClaimButton label="Request a profile claim review" onPress={goClaim} />
          ) : claim ? (
            <ProfileClaimButton label="View profile claim status" onPress={goClaim} />
          ) : claims?.request_eligibility?.allowed ? (
            <ProfileClaimButton label="Claim this profile" onPress={goClaim} />
          ) : null}
          {publicLink}
        </View>
      </>
    );
  return (
    <>
      <AccountIntro mode="manage" record={record} onPublic={onPublic} />
      <CandidateAccountIdentity record={record} verified />
      {failure ? (
        <CandidateNotice error>
          <Text role="alert" style={candidateText.body}>
            {failure === 'give'
              ? copy.giveUnknown
              : failure === 'load'
                ? copy.failed
                : 'We couldn’t complete this request'}
          </Text>
          {failure === 'write' ? (
            <Text style={candidateText.body}>
              Try again reads what is public before another save
            </Text>
          ) : null}
          <ProfileClaimButton
            label={failure === 'give' ? 'Reload profile claim status' : 'Try again'}
            busy={loading}
            busyLabel="Loading profile claim status…"
            onPress={() => void load(true)}
          />
        </CandidateNotice>
      ) : null}
      {recovered && loaded ? (
        <View style={{ gap: 12 }}>
          <Text style={candidateText.strong}>Current public statement</Text>
          {publicBody ? (
            <CandidateCampaignStatement record={record} statement={loaded.statement!} />
          ) : (
            <Text style={candidateText.body}>No campaign statement is public</Text>
          )}
        </View>
      ) : null}
      <View style={{ marginTop: 28 }}>
        <CandidateField
          label="Campaign statement"
          labelLevel={2}
          labelAside={
            loaded?.statement?.updated_at ? (
              <Text style={[candidateText.body, { fontSize: 14.5 }]}>
                Published {candidateDate(loaded.statement.updated_at.slice(0, 10))}
              </Text>
            ) : undefined
          }
          beforeInput={
            <>
              <Text style={[candidateText.body, { fontSize: 15.5, lineHeight: 23.25 }]}>
                Explain your record or add context in your own words
              </Text>
              <View style={{ marginTop: 8 }}>
                <CandidateRecordBoundary compact>
                  Your statement appears separately from official records
                </CandidateRecordBoundary>
              </View>
            </>
          }
          inputStyle={{
            marginTop: 6,
            minHeight: 220,
            paddingVertical: 14,
            paddingHorizontal: 16,
            fontSize: 16.5,
            lineHeight: 26.4,
          }}
          value={draft}
          maxLength={2000}
          onChange={(value) => {
            setDraft(value);
            setMessage('');
          }}
          multiline
          readOnly={Boolean(busy) || Boolean(failure) || loading}
        />
      </View>
      <View accessibilityLiveRegion="polite" style={{ minHeight: 24 }}>
        <Text style={candidateText.strong}>{message}</Text>
      </View>
      <View
        style={[
          candidateAccountStyles.actions,
          isMobile && { flexDirection: 'column', alignItems: 'stretch' },
        ]}
      >
        <ProfileClaimButton
          label="Preview"
          expanded={preview}
          controls="campaign-statement-preview"
          disabled={Boolean(busy) || Boolean(failure) || loading}
          width={isMobile ? '100%' : undefined}
          onPress={() => setPreview((value) => !value)}
        />
        <ProfileClaimButton
          label={publicBody ? 'Save changes' : 'Publish statement'}
          busyLabel={publicBody ? 'Saving…' : 'Publishing…'}
          busy={busy === 'save'}
          kind="green"
          width={isMobile ? '100%' : 220}
          disabled={!dirty || !draft.trim() || Boolean(busy) || Boolean(failure) || loading}
          onPress={() => void write('save')}
        />
        {publicBody ? (
          <ProfileClaimButton
            label="Remove statement"
            kind="danger-text"
            style={{ marginLeft: isMobile ? 0 : 'auto' }}
            busyLabel="Removing statement…"
            busy={busy === 'remove'}
            disabled={Boolean(busy) || Boolean(failure) || loading}
            width={isMobile ? '100%' : undefined}
            onPress={() => setDialog('remove')}
          />
        ) : null}
      </View>
      {preview ? (
        <View
          nativeID="campaign-statement-preview"
          style={{
            marginTop: 22,
            padding: 14,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: 'rgba(17,21,15,.28)',
            borderRadius: 18,
          }}
        >
          <Text
            style={[
              candidateText.strong,
              { paddingHorizontal: 4, paddingBottom: 10, fontSize: 10.5, letterSpacing: 1.26 },
            ]}
          >
            PREVIEW
          </Text>
          <CandidateCampaignStatement
            preview
            record={record}
            statement={{
              body: draft,
              updated_at: loaded?.statement?.updated_at ?? new Date().toISOString(),
              version: loaded?.statement?.version ?? 0,
            }}
          />
        </View>
      ) : null}
      <View
        style={{
          borderTopWidth: 1,
          borderColor: 'rgba(17,21,15,.1)',
          marginTop: 34,
          paddingTop: 22,
          maxWidth: 600,
          gap: 8,
        }}
      >
        <ProfileClaimButton
          label="Give up this profile claim"
          kind="danger"
          disabled={Boolean(busy) || Boolean(failure) || loading}
          width={isMobile ? '100%' : undefined}
          onPress={() => setDialog('withdraw')}
        />
        <Text style={candidateText.body}>
          {publicBody
            ? 'Giving up your profile claim ends your campaign access and removes your published campaign statement'
            : 'Giving up your profile claim ends your campaign access to manage this candidate profile’s statement'}
        </Text>
      </View>
      {loaded?.history.length ? (
        <View style={{ marginTop: 28, gap: 12 }}>
          <Text accessibilityRole="header" aria-level={2} style={candidateText.strong}>
            Statement history
          </Text>
          {loaded.history.map((revision) => (
            <View key={revision.id} style={candidateAccountStyles.identity}>
              <Text style={candidateText.strong}>
                {revision.action === 'removed' ? 'Statement removed' : 'Statement saved'} ·{' '}
                {candidateDate(revision.created_at.slice(0, 10))}
              </Text>
              {revision.body ? <Text style={candidateText.body}>{revision.body}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <Text
        style={[
          candidateText.body,
          {
            marginTop: 32,
            paddingTop: 18,
            borderTopWidth: 1,
            borderColor: 'rgba(17,21,15,.1)',
            fontSize: 14.5,
            lineHeight: 21.75,
          },
        ]}
      >
        Explanations attached to individual votes and paid campaign services are not available yet
      </Text>
      {dialog === 'withdraw' ? (
        <CandidateDialog
          title="Give up your profile claim?"
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <Text style={candidateText.body}>
            {publicBody
              ? 'You will lose campaign access to manage this candidate profile’s statement. Your published campaign statement will be removed. The public candidate profile and official records will remain.'
              : 'You will lose campaign access to manage this candidate profile’s statement. The public candidate profile and official records will remain.'}
          </Text>
          {dirty ? (
            <Text style={candidateText.strong}>Your unsaved changes will be discarded</Text>
          ) : null}
          <CandidateDialogActions>
            <ProfileClaimButton
              label="Keep profile claim"
              kind="green"
              disabled={Boolean(busy)}
              width={isMobile ? '100%' : undefined}
              onPress={() => setDialog(null)}
            />
            <ProfileClaimButton
              label="Give up profile claim"
              busyLabel="Giving up profile claim…"
              busy={busy === 'withdraw'}
              kind="danger"
              width={isMobile ? '100%' : 260}
              onPress={() => void write('withdraw')}
            />
          </CandidateDialogActions>
        </CandidateDialog>
      ) : dialog ? (
        <CandidateDialog
          title={
            dialog === 'remove'
              ? 'Remove your statement from the public profile?'
              : 'You have unsaved changes'
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <CandidateDialogActions>
            <ProfileClaimButton
              kind="green"
              width={isMobile ? '100%' : undefined}
              label={dialog === 'remove' ? 'Keep statement' : 'Keep editing'}
              disabled={Boolean(busy)}
              onPress={() => setDialog(null)}
            />
            <ProfileClaimButton
              label={dialog === 'remove' ? 'Remove statement' : 'Discard changes'}
              busyLabel={dialog === 'remove' ? 'Removing statement…' : undefined}
              busy={busy === 'remove'}
              width={isMobile ? '100%' : undefined}
              kind="danger"
              onPress={() => (dialog === 'leave' ? setDiscarding(true) : void write('remove'))}
            />
          </CandidateDialogActions>
        </CandidateDialog>
      ) : null}
    </>
  );
}
function CandidateAccountScreen({
  mode,
  navigation,
  route,
}: RootScreenProps<'CandidateClaim' | 'CandidateManage'> & { mode: 'claim' | 'manage' }) {
  const id = route.params.candidateId;
  const { isLoading, isSignedIn, user, accessToken } = useAuth();
  const { openSignIn } = useSignInModal();
  const { isMobile, isDesktop } = useResponsive();
  const [record, setRecord] = useState<CandidateProfileRecord | null>(null);
  const [error, setError] = useState<'not-found' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const admin = useAdminAccess();
  const title = mode === 'claim' ? 'Claim this profile' : 'Manage this profile';
  useDocumentTitle(`/candidates/${id}/${mode}`, `${title} | Alethical`);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setError(null);
    void getCandidateProfile(id, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setRecord(result);
      },
      (failure) => {
        if (!controller.signal.aborted) setError(isNotFoundError(failure) ? 'not-found' : 'error');
      },
    );
    return () => controller.abort();
  }, [id, attempt]);
  if (error === 'not-found')
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: `/candidates/${id}/${mode}` } } as never}
      />
    );
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <View
          style={{
            paddingHorizontal: isMobile ? 20 : isDesktop ? 40 : 32,
            paddingTop: isMobile ? 18 : isDesktop ? 26 : 24,
            paddingBottom: 64,
          }}
        >
          <View
            style={{
              maxWidth: mode === 'claim' ? 640 : 720,
              width: '100%',
              alignSelf: 'center',
            }}
          >
            {error ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>Candidate record is unavailable</Text>
                <CandidateButton
                  label="Try again"
                  kind="outline"
                  onPress={() => setAttempt((value) => value + 1)}
                />
              </CandidateNotice>
            ) : record?.candidate.id !== id ? (
              <Text role="status" style={candidateText.body}>
                Loading candidate record…
              </Text>
            ) : isLoading ? (
              <>
                <CandidateAccountIdentity record={record} />
                <Text
                  accessibilityLiveRegion="polite"
                  style={[candidateText.body, { marginTop: 26 }]}
                >
                  Loading account…
                </Text>
              </>
            ) : !isSignedIn || !user || !accessToken ? (
              <>
                <AccountIntro
                  mode={mode}
                  record={record}
                  onPublic={() => navigation.navigate('CandidateProfile', { candidateId: id })}
                />
                <CandidateAccountIdentity record={record} />
                <View style={{ marginTop: 26 }}>
                  <CandidateButton
                    label="Sign in to continue"
                    icon="none"
                    onPress={() =>
                      openSignIn({ intent: 'nav', returnTo: `/candidates/${id}/${mode}` })
                    }
                  />
                </View>
              </>
            ) : admin.state === 'allowed' ? (
              <>
                {mode === 'manage' ? (
                  <CandidateLink
                    internal
                    direction="back"
                    url={`/candidates/${id}`}
                    label="View public profile"
                    onPress={() => navigation.navigate('CandidateProfile', { candidateId: id })}
                  />
                ) : (
                  <CandidateAccountIdentity record={record} />
                )}
                <View style={{ marginTop: mode === 'manage' ? 14 : 26 }}>
                  <CandidateStatusHeading title={copy.adminBlock} kind="admin" />
                </View>
                <View
                  style={{
                    marginTop: 22,
                    gap: 10,
                    flexDirection: isMobile ? 'column' : 'row',
                    flexWrap: 'wrap',
                    alignItems: isMobile ? 'stretch' : 'center',
                  }}
                >
                  <CandidateButton
                    label="Review profile claim requests"
                    kind="outline"
                    icon="none"
                    onPress={() => navigation.navigate('AdminCandidateClaims', { candidateId: id })}
                  />
                  {mode === 'claim' ? (
                    <CandidateLink
                      internal
                      url={`/candidates/${id}`}
                      label="View public profile"
                      onPress={() => navigation.navigate('CandidateProfile', { candidateId: id })}
                    />
                  ) : null}
                </View>
                {mode === 'manage' ? <CandidateAccountIdentity record={record} /> : null}
              </>
            ) : admin.state === 'loading' || admin.state === 'error' ? (
              <>
                <CandidateAccountIdentity record={record} />
                <View style={{ marginTop: 26 }}>
                  <CandidateNotice error={admin.state === 'error'}>
                    <Text style={candidateText.body}>
                      {admin.state === 'error' ? copy.failed : copy.loading}
                    </Text>
                    {admin.state === 'error' ? (
                      <ProfileClaimButton label="Try again" onPress={admin.retry} />
                    ) : null}
                  </CandidateNotice>
                  <CandidateLink
                    internal
                    url={`/candidates/${id}`}
                    label="View public profile"
                    onPress={() => navigation.navigate('CandidateProfile', { candidateId: id })}
                  />
                </View>
              </>
            ) : mode === 'claim' ? (
              <ClaimForm
                key={`${id}:${user.id}`}
                record={record}
                token={accessToken}
                onManage={() => navigation.navigate('CandidateManage', { candidateId: id })}
                onAdmin={() => navigation.navigate('AdminCandidateClaims', { candidateId: id })}
                onPublic={() => navigation.navigate('CandidateProfile', { candidateId: id })}
              />
            ) : (
              <ManageContent
                key={`${id}:${user.id}`}
                record={record}
                token={accessToken}
                navigation={navigation as never}
              />
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
export function CandidateClaimScreen(props: RootScreenProps<'CandidateClaim'>) {
  return <CandidateAccountScreen {...props} mode="claim" />;
}
export function CandidateManageScreen(props: RootScreenProps<'CandidateManage'>) {
  return <CandidateAccountScreen {...props} mode="manage" />;
}
