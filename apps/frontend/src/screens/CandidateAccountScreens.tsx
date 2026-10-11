import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Platform, ScrollView, Text, TextInput, View, type TextStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import {
  CandidateAccountIdentity,
  CandidateField,
  CandidateDialog,
  CandidateStatusHeading,
  CandidateDialogActions,
  CandidateStatusIcon,
  candidateAccountStyles,
} from '../components/candidates/CandidateAccountControls';
import { CandidateCampaignStatement } from '../components/candidates/CandidateClaimPanel';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateText,
  safeCandidateUrl,
} from '../components/candidates/CandidateControls';
import type { CandidateProfileRecord } from '../components/candidates/types';
import { GoBackLink } from '../components/GoBackLink';
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
  profileClaimDate,
  profileClaimExplanationError,
  profileClaimFormErrors,
  profileClaimErrorReason,
  claimAccountBlock,
  savedProfileClaimRequest,
  statementDateLine,
  PROFILE_CLAIM_ROLES,
} from '../components/candidates/profileClaimCopy';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { useResponsive } from '../hooks/useResponsive';
import { candidateFeaturesPath } from '../lib/candidateFeatures';
import {
  clearProfileClaimDraft,
  readProfileClaimDraft,
  requestProfileClaimDraftFromOpener,
  saveProfileClaimDraft,
  type ProfileClaimDraft,
} from '../lib/profileClaimDraft';
import { useDocumentTitle } from '../navigation/documentTitle';
import { GuardedNavigationContext } from '../navigation/GuardedNavigationContext';
import { createGuardedWebHistory } from '../navigation/guardedWebHistory';
import type { RootScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { NotFoundScreen } from './redesign/NotFoundScreen';

const web = (style: object) => (Platform.OS === 'web' ? (style as TextStyle) : undefined);
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function useRequestLifetime() {
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  return () => lifetime.current.signal;
}
function useBands() {
  const { isMobile, isDesktop } = useResponsive();
  return {
    isMobile,
    isDesktop,
    h1: isMobile ? 30 : isDesktop ? 40 : 36,
    status: isMobile ? 26 : isDesktop ? 32 : 30,
    lead: isMobile ? 16 : isDesktop ? 18 : 17,
    subhead: isMobile ? 18 : isDesktop ? 20 : 19,
    h2: isMobile ? 19 : isDesktop ? 21 : 20,
  };
}
function PageHeading({ children, marginTop = 18 }: { children: ReactNode; marginTop?: number }) {
  const { h1 } = useBands();
  return (
    <Text
      accessibilityRole="header"
      aria-level={1}
      style={[
        candidateText.title,
        { marginTop, fontSize: h1, lineHeight: h1 * 1.08, letterSpacing: h1 * -0.02 },
      ]}
    >
      {children}
    </Text>
  );
}
function Lead({ children, marginTop = 12 }: { children: ReactNode; marginTop?: number }) {
  const { lead } = useBands();
  return (
    <Text
      style={[
        candidateText.body,
        { marginTop, fontSize: lead, lineHeight: lead * 1.5, color: '#2c322c' },
        web({ textWrap: 'pretty' }),
      ]}
    >
      {children}
    </Text>
  );
}
function LockIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Rect x={5} y={10.5} width={14} height={10} rx={2.2} stroke="#4f5651" strokeWidth={2} />
      <Path d="M8 10.5 V8 a4 4 0 0 1 8 0 V10.5" stroke="#4f5651" strokeWidth={2} />
    </Svg>
  );
}
/** "Profile claims closed for this election" as the page heading, with its lock. */
function ClosedHeading() {
  const { status, isMobile } = useBands();
  return (
    <View style={{ marginTop: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ marginTop: isMobile ? 1 : 3 }}>
        <LockIcon />
      </View>
      <Text
        accessibilityRole="header"
        aria-level={1}
        style={[
          candidateText.title,
          {
            flex: 1,
            fontSize: status,
            lineHeight: status * 1.12,
            letterSpacing: status * -0.02,
          },
          web({ textWrap: 'pretty' }),
        ]}
      >
        {copy.closedTitle}
      </Text>
    </View>
  );
}
function FieldErrorIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={12} cy={12} r={9} stroke="#a3421a" strokeWidth={2} />
      <Path d="M12 7.5 V13 M12 16 V16.1" stroke="#a3421a" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
export function ProfileClaimFieldError({ id, message }: { id?: string; message: string }) {
  return (
    <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ marginTop: 1 }}>
        <FieldErrorIcon />
      </View>
      <Text
        nativeID={id}
        role="alert"
        style={[
          candidateText.strong,
          { flex: 1, fontSize: 15, lineHeight: 21.75, color: '#a3421a' },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}
function WarningBox({
  children,
  role = 'alert',
}: {
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <View
      role={role}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#fdf6e7',
        borderWidth: 1,
        borderColor: '#efd9a8',
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}
function SourceBlockedBox() {
  return (
    <WarningBox>
      <View style={{ marginTop: 2 }}>
        <CandidateStatusIcon kind="warning" size={18} />
      </View>
      <Text
        style={[
          candidateText.strong,
          { flex: 1, fontSize: 15.5, lineHeight: 23.25 },
          web({ textWrap: 'pretty' }),
        ]}
      >
        {copy.sourceBlocked}
      </Text>
    </WarningBox>
  );
}
function UnknownBox({ message }: { message: string }) {
  return (
    <View
      role="alert"
      style={{
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#fdf6e7',
        borderWidth: 1,
        borderColor: '#efd9a8',
        borderRadius: 12,
      }}
    >
      <Text
        style={[
          candidateText.strong,
          { fontSize: 15.5, lineHeight: 23.25, fontWeight: '600' },
          web({ textWrap: 'pretty' }),
        ]}
      >
        {message}
      </Text>
    </View>
  );
}
function PublicProfileLink({ candidateId, onPublic }: { candidateId: string; onPublic(): void }) {
  return (
    <CandidateLink
      internal
      textSize={16}
      url={`/candidates/${candidateId}`}
      label="View public profile"
      onPress={onPublic}
      style={{ minHeight: 48, paddingHorizontal: 4 }}
    />
  );
}
function ActionRow({ children, top = 22 }: { children: ReactNode; top?: number }) {
  const { isMobile } = useBands();
  return (
    <View
      style={{
        marginTop: top,
        flexDirection: isMobile ? 'column' : 'row',
        flexWrap: 'wrap',
        alignItems: isMobile ? 'stretch' : 'center',
        columnGap: 14,
        rowGap: 12,
      }}
    >
      {children}
    </View>
  );
}
function LinkButton({
  label,
  href,
  onPress,
  kind = 'green',
  tall = false,
}: {
  label: string;
  href: string;
  onPress(): void;
  kind?: 'green' | 'outline';
  tall?: boolean;
}) {
  const { isMobile } = useBands();
  return (
    <CandidateButton
      label={label}
      href={href}
      kind={kind}
      icon="none"
      fontSize={tall ? 17 : 16}
      textStyle={{ lineHeight: tall ? 22.1 : 20.8 }}
      onPress={onPress}
      style={{
        minHeight: tall ? 52 : 48,
        paddingVertical: 12,
        paddingHorizontal: tall ? 26 : 24,
        alignSelf: isMobile ? 'stretch' : 'flex-start',
      }}
    />
  );
}
/** The applicant's saved answers, read-only: only their own account and admins see them. */
function SubmittedInformation({ claim }: { claim: CandidateClaim }) {
  const { isMobile, subhead } = useBands();
  const saved = savedProfileClaimRequest(claim.request_note);
  const submitted = profileClaimDate(claim.submitted_at);
  const link = safeCandidateUrl(claim.evidence_url);
  const inset = isMobile ? 18 : 22;
  const dt = {
    fontFamily: candidateText.body.fontFamily,
    fontSize: 14,
    lineHeight: '20px',
    fontWeight: 700,
    color: '#4f5651',
  };
  const dd = {
    margin: '4px 0 0',
    fontFamily: candidateText.body.fontFamily,
    fontSize: 16,
    lineHeight: 1.55,
    color: '#11150f',
    overflowWrap: 'anywhere' as const,
  };
  return (
    <View style={{ marginTop: 30 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          columnGap: 16,
          rowGap: 4,
        }}
      >
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[
            candidateText.title,
            { fontSize: subhead, lineHeight: subhead * 1.25, letterSpacing: subhead * -0.01 },
          ]}
        >
          {copy.submittedHeading}
        </Text>
        {submitted ? (
          <Text
            style={[
              candidateText.body,
              { fontSize: 15, lineHeight: 21.75, fontWeight: '600', fontVariant: ['tabular-nums'] },
            ]}
          >
            Submitted {submitted}
          </Text>
        ) : null}
      </View>
      <dl
        aria-describedby="profile-claim-privacy-note"
        style={{
          margin: '12px 0 0',
          padding: isMobile ? 18 : '20px 22px',
          background: '#f1f2f4',
          border: '1px solid rgba(17,21,15,0.1)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {saved.role ? (
          <div>
            <dt style={dt}>Your role</dt>
            <dd style={dd}>{saved.role}</dd>
          </div>
        ) : null}
        <div>
          <dt style={dt}>Campaign website or official record</dt>
          <dd style={dd}>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="profile-claim-saved-link"
                style={{
                  color: '#0f7a45',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                {claim.evidence_url}
                <span style={{ ...visuallyHidden, position: 'absolute' }}>
                  {' '}
                  (opens in a new tab)
                </span>
              </a>
            ) : (
              claim.evidence_url
            )}
          </dd>
        </div>
        <div>
          <dt style={dt}>Your explanation</dt>
          <dd style={{ ...dd, whiteSpace: 'pre-wrap' }}>{saved.explanation}</dd>
        </div>
      </dl>
      <Text
        nativeID="profile-claim-privacy-note"
        style={[
          candidateText.body,
          { marginTop: 10, paddingHorizontal: inset, fontSize: 15, lineHeight: 22.5 },
          web({ textWrap: 'pretty' }),
        ]}
      >
        {copy.privacyNote}
      </Text>
    </View>
  );
}
const EMPTY_CLAIM_DRAFT: ProfileClaimDraft = { role: '', link: '', explanation: '', errors: {} };
function ClaimForm({
  record,
  token,
  accountKey,
  onManage,
  onAdmin,
  onPublic,
  onBack,
}: {
  record: CandidateProfileRecord;
  token: string;
  accountKey: string;
  onManage(): void;
  onAdmin(): void;
  onPublic(): void;
  onBack(): void;
}) {
  const signal = useRequestLifetime();
  const focused = useIsFocused();
  const { isMobile } = useBands();
  const candidateId = record.candidate.id;
  const saved = useRef(readProfileClaimDraft(accountKey, candidateId)).current;
  const [response, setResponse] = useState<CandidateClaimList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'submit' | 'withdraw' | null>(null);
  const writing = useRef(false);
  const [unknown, setUnknown] = useState<'submit' | 'withdraw' | null>(null);
  const [knownError, setKnownError] = useState('');
  const [already, setAlready] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [role, setRole] = useState(saved?.role ?? '');
  const [evidence, setEvidence] = useState(saved?.link ?? '');
  const [note, setNote] = useState(saved?.explanation ?? '');
  const [errors, setErrors] = useState<ReturnType<typeof profileClaimFormErrors>>(
    saved?.errors ?? {},
  );
  const roles = useRef<HTMLFieldSetElement>(null);
  const linkRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);
  const statusRef = useRef<View>(null);
  const seenFocus = useRef(false);
  const auth = useAuth();
  const live = useRef({ auth, role, evidence, note, errors, edited: false });
  live.current = {
    auth,
    role,
    evidence,
    note,
    errors,
    edited: live.current.edited || Boolean(role || evidence || note || Object.keys(errors).length),
  };
  useEffect(() => {
    saveProfileClaimDraft(accountKey, candidateId, {
      role,
      link: evidence,
      explanation: note,
      errors,
    });
  }, [accountKey, candidateId, role, evidence, note, errors]);
  const current = response?.claims.find((item) => item.candidate_id === candidateId);
  const reason = response?.request_eligibility?.reason;
  const closed =
    current?.election_ended ?? (reason === 'election_ended' || record.electionEnded === true);
  const canRequest = response?.request_eligibility?.allowed === true;
  // A claim page this site opened from another tab's link asks that exact tab, once, for
  // its unsent answers: only after this form has loaded, while signed in to the same
  // account, eligible to request and still empty and untouched. Nothing newer is replaced.
  const askedOpener = useRef(false);
  const eligible = useRef(false);
  eligible.current = canRequest;
  useEffect(() => {
    if (askedOpener.current || saved || !response || !canRequest) return;
    askedOpener.current = true;
    // Lives as long as this form, so a later recheck of eligibility does not cancel it.
    const lifetime = signal();
    // Same account, still eligible, nothing typed here.
    const current = () => {
      const now = live.current;
      return (
        eligible.current && now.auth.isSignedIn && now.auth.user?.id === accountKey && !now.edited
      );
    };
    // Before asking, and when the answers arrive, no answers of this tab's own are held.
    const untouched = () => current() && !readProfileClaimDraft(accountKey, candidateId);
    if (!untouched()) return;
    void requestProfileClaimDraftFromOpener(accountKey, candidateId, untouched, lifetime).then(
      (draft) => {
        // The transfer kept exactly these answers in this tab's memory; anything newer wins.
        if (!draft || lifetime.aborted || !current()) return;
        if (readProfileClaimDraft(accountKey, candidateId) !== draft) return;
        setRole(draft.role);
        setEvidence(draft.link);
        setNote(draft.explanation);
        setErrors(draft.errors);
      },
    );
  }, [response, canRequest]);
  const sourceBlocked = reason === 'official_record_unavailable';
  const loadSeq = useRef(0);
  const load = async (silent = false) => {
    const scope = signal();
    // A slower earlier read (such as the silent recheck on return) never replaces a newer one.
    const seq = ++loadSeq.current;
    const latest = () => !scope.aborted && seq === loadSeq.current;
    if (!silent) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const next = await getMyCandidateClaims(token, candidateId, scope);
      if (latest()) {
        setResponse(next);
        if (!next.request_eligibility?.allowed) setFormOpen(false);
        setUnknown(null);
        setKnownError('');
      }
    } catch {
      if (latest() && !silent) setFailed(true);
    } finally {
      if (latest()) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  // Returning from another page (such as /candidates/features) rechecks eligibility
  // without clearing what was typed.
  useEffect(() => {
    if (!focused) return;
    if (!seenFocus.current) {
      seenFocus.current = true;
      return;
    }
    // Coming back to this claim step shows exactly what this tab last kept for it, which
    // another visit to the claim step may have changed while this one waited unseen. Nothing
    // kept means the answers were emptied (an empty form keeps nothing), so this one empties too.
    const latest = readProfileClaimDraft(accountKey, candidateId) ?? EMPTY_CLAIM_DRAFT;
    const now = live.current;
    const errorsDiffer = (['role', 'link', 'explanation'] as const).some(
      (name) => (latest.errors[name] ?? '') !== (now.errors[name] ?? ''),
    );
    if (
      latest.role !== now.role ||
      latest.link !== now.evidence ||
      latest.explanation !== now.note ||
      errorsDiffer
    ) {
      setRole(latest.role);
      setEvidence(latest.link);
      setNote(latest.explanation);
      setErrors(latest.errors);
    }
    if (!writing.current) void load(true);
  }, [focused]);
  useEffect(() => {
    if (!loading && (current || already))
      (statusRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [loading, current?.status, already, unknown]);
  const focusFirstInvalid = (invalid: ReturnType<typeof profileClaimFormErrors>) => {
    if (invalid.role)
      (
        roles.current?.querySelector<HTMLInputElement>('input:checked') ??
        roles.current?.querySelector<HTMLInputElement>('input')
      )?.focus();
    else if (invalid.link) linkRef.current?.focus();
    else if (invalid.explanation) noteRef.current?.focus();
  };
  const submit = async () => {
    if (writing.current || !response || !canRequest || unknown) return;
    const invalid = profileClaimFormErrors(role, evidence, note);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      focusFirstInvalid(invalid);
      return;
    }
    const scope = signal();
    writing.current = true;
    setBusy('submit');
    setKnownError('');
    try {
      const result = await requestCandidateClaim(
        token,
        {
          candidate_id: candidateId,
          evidence_url: evidence.trim(),
          request_note: `${role}\n\n${note.trim()}`,
          expected_account_id: response.account_id,
          expected_version: current?.version ?? 0,
        },
        scope,
      );
      if (!scope.aborted) {
        setFormOpen(false);
        setAlready(result.already_submitted === true);
        if (result.already_submitted !== true) {
          setRole('');
          setEvidence('');
          setNote('');
          setErrors({});
          clearProfileClaimDraft(accountKey, candidateId);
        }
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
        else if (why === 'explanation_too_short' || why === 'explanation_too_long')
          setErrors({
            explanation:
              profileClaimExplanationError(note) ??
              (why === 'explanation_too_long'
                ? 'Keep your explanation to 1900 characters or fewer'
                : 'Add more detail about how we can confirm your role (at least 20 characters)'),
          });
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
  // Unsent answers for this account and candidate come back as they were left; a submitted
  // request's answers were already cleared on success.
  const openForm = () => setFormOpen(true);
  const publicLink = <PublicProfileLink candidateId={candidateId} onPublic={onPublic} />;
  const status = (content: ReactNode) => (
    <>
      <CandidateAccountIdentity record={record} />
      <View style={{ marginTop: 26 }}>{content}</View>
    </>
  );
  if (loading)
    return status(
      <>
        <View
          role="status"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}
        >
          <Spinner />
          <Text style={[candidateText.strong, { color: '#4f5651' }]}>{copy.loading}</Text>
        </View>
        <View style={{ marginTop: 14 }}>{publicLink}</View>
      </>,
    );
  if (failed)
    return status(
      <>
        <View role="alert" style={claimStyles.greyBox}>
          <Text style={[candidateText.strong, { fontWeight: '800' }]}>{copy.failed}</Text>
          <ProfileClaimButton
            label="Try again"
            onPress={() => void load()}
            style={{ minHeight: 44 }}
          />
        </View>
        <View style={{ marginTop: 14 }}>{publicLink}</View>
      </>,
    );
  if (response?.is_admin)
    return status(
      <>
        <CandidateStatusHeading
          headingRef={statusRef}
          title={copy.adminTitle}
          body={copy.adminBody}
          kind="admin"
        />
        <ActionRow>
          <LinkButton
            kind="outline"
            label="Review profile claim requests"
            href={`/admin/candidate-claims?candidate=${encodeURIComponent(candidateId)}`}
            onPress={onAdmin}
          />
          {publicLink}
        </ActionRow>
      </>,
    );
  if (current && !formOpen) {
    const pending = current.status === 'pending';
    const showSaved = pending && unknown !== 'withdraw';
    const again =
      current.can_request_review && canRequest && !sourceBlocked
        ? current.status === 'withdrawn'
          ? 'Start a new request'
          : 'Request another review'
        : null;
    const blockedAgain =
      sourceBlocked && !closed && ['rejected', 'withdrawn', 'revoked'].includes(current.status);
    const heading =
      unknown === 'withdraw'
        ? closed
          ? copy.endedTitle
          : 'Profile claim request'
        : already && pending
          ? copy.alreadyTitle
          : pending
            ? closed
              ? copy.endedTitle
              : copy.receivedTitle
            : current.status === 'approved'
              ? 'Profile claim approved'
              : current.status === 'rejected'
                ? 'Profile claim not approved'
                : current.status === 'withdrawn'
                  ? 'Profile claim request withdrawn'
                  : 'Profile claim revoked';
    const body =
      unknown === 'withdraw'
        ? undefined
        : already && pending
          ? copy.already
          : pending
            ? closed
              ? copy.ended
              : copy.received
            : current.status === 'approved'
              ? copy.approved
              : current.status === 'rejected'
                ? closed
                  ? copy.rejectedClosed
                  : copy.rejectedOpen
                : current.status === 'withdrawn'
                  ? closed
                    ? copy.claimsClosed
                    : copy.withdrawnOpen
                  : closed
                    ? copy.revokedClosed
                    : copy.revokedOpen;
    const kind =
      unknown === 'withdraw'
        ? 'pending'
        : pending
          ? closed && !already
            ? 'admin'
            : 'pending'
          : current.status === 'approved'
            ? 'approved'
            : current.status === 'withdrawn'
              ? 'withdrawn'
              : 'warning';
    const revokedRemoved =
      current.status === 'revoked' &&
      current.last_event_kind === 'revoked' &&
      current.statement_removed === true;
    const approvedBlock =
      current.status === 'approved' && !current.can_manage
        ? claimAccountBlock(response?.request_eligibility?.reason)
        : null;
    return status(
      <>
        <CandidateStatusHeading headingRef={statusRef} title={heading} body={body} kind={kind}>
          {revokedRemoved ? <Text style={claimStyles.extraNote}>{copy.revokedRemoved}</Text> : null}
          {pending && !closed && !already && unknown !== 'withdraw' ? (
            <Text style={claimStyles.extraNote}>{copy.returnNote}</Text>
          ) : null}
          {approvedBlock ? <Text style={claimStyles.extraNote}>{approvedBlock}</Text> : null}
        </CandidateStatusHeading>
        {showSaved ? <SubmittedInformation claim={current} /> : null}
        {blockedAgain ? (
          <View style={{ marginTop: 22 }}>
            <SourceBlockedBox />
          </View>
        ) : null}
        {unknown === 'withdraw' ? (
          <View style={{ marginTop: 22 }}>
            <UnknownBox message={copy.withdrawUnknown} />
          </View>
        ) : null}
        <ActionRow top={showSaved ? 28 : 22}>
          {unknown === 'withdraw' ? (
            <ProfileClaimButton
              label="Reload profile claim status"
              width={isMobile ? '100%' : undefined}
              onPress={() => void load()}
            />
          ) : null}
          {pending && unknown !== 'withdraw' ? (
            <>
              <LinkButton
                label="View public profile"
                href={`/candidates/${candidateId}`}
                onPress={onPublic}
              />
              <ProfileClaimButton
                label="Withdraw request"
                busyLabel="Withdrawing request…"
                busy={busy === 'withdraw'}
                width={isMobile ? '100%' : undefined}
                onPress={() => void withdraw()}
              />
            </>
          ) : null}
          {current.status === 'approved' && current.can_manage ? (
            <LinkButton
              label="Manage this profile"
              href={`/candidates/${candidateId}/manage`}
              onPress={onManage}
            />
          ) : null}
          {again ? (
            <ProfileClaimButton
              label={again}
              width={isMobile ? '100%' : undefined}
              onPress={openForm}
            />
          ) : null}
          {pending && unknown !== 'withdraw' ? null : publicLink}
        </ActionRow>
      </>,
    );
  }
  if (response?.already_claimed && !formOpen)
    return status(
      <>
        <CandidateStatusHeading
          headingRef={statusRef}
          title={copy.takenTitle}
          body={closed ? copy.claimsClosed : copy.taken}
          kind="warning"
        />
        <ActionRow>
          {!closed && canRequest ? (
            <ProfileClaimButton
              label="Request a review"
              width={isMobile ? '100%' : undefined}
              onPress={openForm}
            />
          ) : null}
          {publicLink}
        </ActionRow>
      </>,
    );
  const block = claimAccountBlock(reason);
  if (block && !sourceBlocked && !closed)
    return status(
      <>
        <CandidateStatusHeading headingRef={statusRef} title={block} kind="warning" />
        <ActionRow>{publicLink}</ActionRow>
      </>,
    );
  if (closed)
    return (
      <>
        <GoBackLink
          href={`/candidates/${candidateId}`}
          onPress={onBack}
          mobile={isMobile}
          pressedColor="#000000"
          style={{ minHeight: 44, marginBottom: 0 }}
        />
        <ClosedHeading />
        <Lead>{copy.electionEnded}</Lead>
        <CandidateAccountIdentity record={record} />
        <ActionRow>{publicLink}</ActionRow>
      </>
    );
  return (
    <>
      <GoBackLink
        href={`/candidates/${candidateId}`}
        onPress={onBack}
        mobile={isMobile}
        pressedColor="#000000"
        style={{ minHeight: 44, marginBottom: 0 }}
      />
      <PageHeading>{copy.claimLabel}</PageHeading>
      <CandidateAccountIdentity record={record} />
      {sourceBlocked ? (
        <View style={{ marginTop: 24 }}>
          <SourceBlockedBox />
        </View>
      ) : (
        <View style={{ marginTop: 26 }}>
          <Text
            style={[
              candidateText.body,
              { fontSize: 16, lineHeight: 24.8, color: '#2c322c' },
              web({ textWrap: 'pretty' }),
            ]}
          >
            {copy.formIntro}
          </Text>
          <fieldset
            ref={roles}
            aria-describedby={errors.role ? 'profile-role-error' : undefined}
            style={{ border: 0, margin: '22px 0 0', padding: 0, minWidth: 0 }}
          >
            <legend
              style={{
                padding: 0,
                fontFamily: candidateText.body.fontFamily,
                fontSize: 17,
                fontWeight: 800,
                color: '#11150f',
              }}
            >
              Your role
            </legend>
            <View style={{ gap: 8, marginTop: 10, flexDirection: isMobile ? 'column' : 'row' }}>
              {PROFILE_CLAIM_ROLES.map((label) => (
                <label
                  key={label}
                  className="profile-claim-role"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 54,
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    border: `1px solid ${role === label ? '#2ed47e' : errors.role ? '#a3421a' : 'rgba(17,21,15,.16)'}`,
                    background: role === label ? '#f2fbf6' : '#fff',
                    borderRadius: 12,
                    fontFamily: candidateText.body.fontFamily,
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#11150f',
                    cursor: busy || unknown ? 'default' : 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    className="profile-claim-input"
                    name={`profile-claim-role-${candidateId}`}
                    checked={role === label}
                    disabled={Boolean(busy) || Boolean(unknown)}
                    aria-invalid={Boolean(errors.role)}
                    onChange={() => {
                      setRole(label);
                      if (errors.role) setErrors((previous) => ({ ...previous, role: undefined }));
                    }}
                    style={{
                      width: 20,
                      height: 20,
                      margin: 0,
                      accentColor: '#0f7a45',
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </label>
              ))}
            </View>
            {errors.role ? (
              <ProfileClaimFieldError id="profile-role-error" message={errors.role} />
            ) : null}
          </fieldset>
          <View style={{ marginTop: 24 }}>
            <CandidateField
              label={copy.link}
              value={evidence}
              onChange={(value) => {
                setEvidence(value);
                if (errors.link)
                  setErrors((previous) => ({
                    ...previous,
                    link: profileClaimFormErrors(role, value, note).link,
                  }));
              }}
              hint={copy.linkHelp}
              error={errors.link}
              errorIcon
              inputRef={linkRef}
              readOnly={Boolean(busy) || Boolean(unknown)}
              inputStyle={{ minHeight: 52, paddingHorizontal: 14, paddingVertical: 12 }}
            />
          </View>
          <View style={{ marginTop: 20 }}>
            <CandidateField
              label={copy.explanation}
              value={note}
              onChange={(value) => {
                setNote(value);
                if (errors.explanation)
                  setErrors((previous) => ({
                    ...previous,
                    explanation: profileClaimExplanationError(value),
                  }));
              }}
              hint={copy.explanationHelp}
              error={errors.explanation}
              errorIcon
              inputRef={noteRef}
              multiline
              readOnly={Boolean(busy) || Boolean(unknown)}
              inputStyle={{ paddingHorizontal: 14, paddingVertical: 12, lineHeight: 24.8 }}
            />
          </View>
          {knownError ? (
            <View style={{ marginTop: 16 }}>
              <Text role="alert" style={candidateText.strong}>
                {knownError}
              </Text>
            </View>
          ) : null}
          {unknown ? (
            <View style={{ marginTop: 22 }}>
              <UnknownBox message={copy.submitUnknown} />
              <View style={{ marginTop: 14 }}>
                <ProfileClaimButton
                  label="Reload profile claim status"
                  width={isMobile ? '100%' : 380}
                  style={{ minHeight: 52, fontSize: 17 }}
                  onPress={() => void load()}
                />
              </View>
            </View>
          ) : (
            <View style={{ marginTop: 24 }}>
              <ProfileClaimButton
                label="Submit profile claim request"
                busyLabel="Submitting profile claim request…"
                kind="green"
                width={isMobile ? '100%' : 380}
                busy={busy === 'submit'}
                disabled={!canRequest}
                style={{ minHeight: 52, fontSize: 17 }}
                onPress={() => void submit()}
              />
            </View>
          )}
        </View>
      )}
    </>
  );
}
function Spinner({ color = '#4f5651' }: { color?: string }) {
  return (
    <View
      aria-hidden
      {...({ dataSet: { candidateSpinner: 'true' } } as object)}
      style={{ width: 18, height: 18 }}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
        <Circle cx={12} cy={12} r={9} stroke="#e2e5e4" strokeWidth={2.4} />
        <Path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    </View>
  );
}
type WriteKind = 'publish' | 'save' | 'remove';
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
  const { isMobile, isDesktop, h2 } = useBands();
  const candidateId = record.candidate.id;
  const [claims, setClaims] = useState<CandidateClaimList | null>(null);
  const [loaded, setLoaded] = useState<PrivateCandidateStatement | null>(null);
  const [draft, setDraft] = useState('');
  const initialised = useRef(false);
  const writing = useRef(false);
  const [busy, setBusy] = useState<WriteKind | 'checking' | 'withdraw' | null>(null);
  const [lastKind, setLastKind] = useState<WriteKind | null>(null);
  // The statement version the failed write expected, so Try again can tell a lost
  // response from a change saved somewhere else.
  const failedVersion = useRef<number | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  // Set only by the reader's own retry or refused write, so a background read never moves focus.
  const revealAccess = useRef(false);
  const accessHeadingRef = useRef<View>(null);
  // The message takes focus when the group appears, unless the reader already moved on.
  useEffect(() => {
    if (!changedElsewhere || typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const message = document.getElementById('statement-changed-message');
    message?.setAttribute('tabindex', '-1');
    message?.focus();
  }, [changedElsewhere]);
  const [failure, setFailure] = useState<'load' | 'write' | 'give' | null>(null);
  const [fieldError, setFieldError] = useState<'empty' | 'over' | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [givenUp, setGivenUp] = useState<{ removed: boolean } | null>(null);
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<'remove' | 'leave' | 'withdraw' | null>(null);
  const [leaveAction, setLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);
  const editorRef = useRef<TextInput>(null);
  const giveUpRef = useRef<View>(null);
  const removeRef = useRef<View>(null);
  // Safari never focuses a clicked button, so closing a dialog names its return target.
  const focusButtonIn = (ref: RefObject<View | null>, fallback?: () => void) => () => {
    const button = (ref.current as unknown as HTMLElement | null)?.querySelector?.('button');
    if (button) button.focus();
    else fallback?.();
  };
  const { cancelPendingNavigation, installHistoryGuard } = useContext(GuardedNavigationContext);
  useLayoutEffect(() => {
    installHistoryGuard(createGuardedWebHistory);
  }, [installHistoryGuard]);
  const focusEditor = () => editorRef.current?.focus();
  const keepEditing = () => {
    cancelPendingNavigation();
    setLeaveAction(null);
    setDialog(null);
  };
  const claim = claims?.claims.find((item) => item.candidate_id === candidateId);
  const canManage = claims?.is_admin !== true && claim?.can_manage === true;
  // When the reader's own retry or write finds access gone, the page shows the current access
  // state instead of the editor; its heading takes focus and comes into view from any scroll.
  useEffect(() => {
    if (!revealAccess.current || canManage || !claims) return;
    revealAccess.current = false;
    const heading = accessHeadingRef.current as unknown as HTMLElement | null;
    heading?.focus?.({ preventScroll: true });
    heading?.scrollIntoView?.({ block: 'start' });
  }, [canManage, claims]);
  const publicBody = loaded?.statement?.body ?? '';
  const published = Boolean(publicBody);
  const dirty = canManage && initialised.current && draft !== publicBody && !givenUp;
  const characters = [...draft].length;
  const clearPrivate = () => {
    setChangedElsewhere(false);
    setLoaded(null);
    setDraft('');
    setClaims(null);
    initialised.current = false;
    setPreview(false);
    setDialog(null);
  };
  const load = async () => {
    const scope = signal();
    setLoading(true);
    try {
      const mine = await getMyCandidateClaims(token, candidateId, scope);
      if (scope.aborted) return;
      const access = mine.claims.find((item) => item.candidate_id === candidateId);
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
        if (access?.last_event_kind === 'given_up')
          setGivenUp({ removed: access.statement_removed === true });
      }
    } catch (error) {
      if (!scope.aborted) {
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) clearPrivate();
        setFailure('load');
      }
    } finally {
      if (!scope.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  usePreventRemove(Boolean(dirty) && !discarding, ({ data }) => {
    setLeaveAction(data.action);
    setDialog('leave');
  });
  useEffect(() => {
    if (discarding && leaveAction) navigation.dispatch(leaveAction);
  }, [discarding, leaveAction, navigation]);
  useEffect(() => {
    if (!dirty || discarding || typeof window === 'undefined') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, discarding]);
  // A shorter editor that grows with the text up to 520px, then scrolls.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = editorRef.current as unknown as HTMLTextAreaElement | null;
    if (!element?.style) return;
    const fit = () => {
      element.style.height = '0px';
      element.style.height = `${Math.min(520, Math.max(136, element.scrollHeight + 2))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    void document.fonts?.ready.then(fit);
    return () => window.removeEventListener('resize', fit);
  }, [draft, loading, canManage]);
  const check = (kind: WriteKind, text: string) =>
    kind === 'remove'
      ? null
      : kind === 'publish' && !text.trim()
        ? ('empty' as const)
        : [...text].length > 2000
          ? ('over' as const)
          : null;
  const send = async (kind: WriteKind, version: number) => {
    if (!claim || !claims) return;
    const scope = signal();
    const identity = { expected_account_id: claims.account_id, expected_version: version };
    if (kind === 'remove') await removeCandidateStatement(token, claim.id, identity, scope);
    else await saveCandidateStatement(token, claim.id, { ...identity, body: draft }, scope);
    const next = await getPrivateCandidateStatement(token, claim.id, scope);
    if (scope.aborted) return;
    setLoaded(next);
    setDraft(next.statement?.body ?? '');
    setDialog(null);
    setChangedElsewhere(false);
    setMessage(
      kind === 'remove'
        ? 'Statement removed'
        : kind === 'publish'
          ? 'Statement published'
          : 'Changes saved',
    );
  };
  const failed = (kind: WriteKind | 'withdraw', error: unknown) => {
    setDialog(null);
    // Access ended or the sign-in lapsed: drop the private text and show the current
    // access state from a fresh read, never offering to repeat the write.
    if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
      revealAccess.current = true;
      clearPrivate();
      setFailure(null);
      void load();
      return;
    }
    setFailure(kind === 'withdraw' ? 'give' : 'write');
  };
  const write = async (kind: WriteKind) => {
    if (!claim || !claims || !canManage || writing.current || loading) return;
    // Saving an emptied public statement is a removal, so it asks first like Remove statement.
    if (kind === 'save' && !draft.trim()) {
      setFieldError(null);
      setDialog('remove');
      return;
    }
    const invalid = check(kind, draft);
    setFieldError(invalid);
    if (invalid) {
      focusEditor();
      return;
    }
    writing.current = true;
    setBusy(kind);
    setLastKind(kind);
    setMessage('');
    setFailure(null);
    const expected = loaded?.statement?.version ?? 0;
    try {
      await send(kind, expected);
    } catch (error) {
      failedVersion.current = expected;
      if (!signal().aborted) failed(kind, error);
    } finally {
      writing.current = false;
      if (!signal().aborted) setBusy(null);
    }
  };
  /** Read what was saved first, then repeat only the last action, and only if still needed. */
  const retry = async () => {
    if (!claim || !claims || writing.current || !lastKind) return;
    const scope = signal();
    writing.current = true;
    setBusy('checking');
    let attempted: number | null = null;
    try {
      // Former owners can still read their history, so first confirm this account
      // still manages this claim. If not, show the current access state; write nothing.
      const mine = await getMyCandidateClaims(token, candidateId, scope);
      if (scope.aborted) return;
      const access = mine.claims.find((item) => item.candidate_id === candidateId);
      if (mine.is_admin === true || !access?.can_manage || access.id !== claim.id) {
        revealAccess.current = true;
        clearPrivate();
        setFailure(null);
        setFieldError(null);
        setMessage('');
        // A different claim now manages it: start again from that claim's saved state.
        if (mine.is_admin !== true && access?.can_manage) void load();
        else setClaims(mine);
        return;
      }
      setClaims(mine);
      const fresh = await getPrivateCandidateStatement(token, claim.id, scope);
      if (scope.aborted) return;
      setLoaded(fresh);
      const saved = fresh.statement?.body ?? '';
      const version = fresh.statement?.version ?? 0;
      // Saved somewhere else since the failed write: never overwrite or remove what the
      // owner has not seen. The editor keeps their text, now unsaved against the new state,
      // and the page says so and shows what is published now.
      const savedElsewhere = () => {
        if (failedVersion.current === null || version === failedVersion.current) return false;
        setFailure(null);
        setFieldError(null);
        setMessage('');
        setChangedElsewhere(true);
        return true;
      };
      if (lastKind === 'remove') {
        if (!saved) {
          setFailure(null);
          setDraft('');
          setMessage('Statement removed');
          return;
        }
        if (savedElsewhere()) return;
        setBusy('remove');
        attempted = version;
        await send('remove', version);
        setFailure(null);
        return;
      }
      if (saved && saved === draft.trim()) {
        setFailure(null);
        setDraft(saved);
        setMessage(lastKind === 'publish' ? 'Statement published' : 'Changes saved');
        return;
      }
      if (savedElsewhere()) return;
      const kind: WriteKind = saved ? 'save' : 'publish';
      // The same checks as the first press: an emptied public statement asks before removal.
      if (kind === 'save' && !draft.trim()) {
        setFailure(null);
        setFieldError(null);
        setDialog('remove');
        return;
      }
      const invalid = check(kind, draft);
      setFieldError(invalid);
      if (invalid) {
        setFailure(null);
        focusEditor();
        return;
      }
      setBusy(kind);
      setLastKind(kind);
      attempted = version;
      await send(kind, version);
      setFailure(null);
    } catch (error) {
      if (attempted !== null) failedVersion.current = attempted;
      if (!scope.aborted) failed(lastKind, error);
    } finally {
      writing.current = false;
      if (!scope.aborted) setBusy(null);
    }
  };
  const giveUp = async () => {
    if (!claim || !claims || !canManage || writing.current) return;
    const scope = signal();
    writing.current = true;
    setBusy('withdraw');
    setMessage('');
    try {
      const result = await withdrawCandidateClaim(
        token,
        claim.id,
        { expected_account_id: claims.account_id, expected_version: claim.version },
        scope,
      );
      if (!scope.aborted) {
        setGivenUp({ removed: result.claim.statement_removed === true });
        setDraft('');
        setLoaded(null);
        initialised.current = false;
        setPreview(false);
        setClaims({
          ...claims,
          claims: claims.claims.map((item) => (item.id === claim.id ? result.claim : item)),
        });
        setDialog(null);
        profileClaimsChanged();
      }
    } catch (error) {
      if (!scope.aborted) failed('withdraw', error);
    } finally {
      writing.current = false;
      if (!scope.aborted) setBusy(null);
    }
  };
  const goClaim = () => navigation.navigate('CandidateClaim', { candidateId });
  const onPublic = () => navigation.navigate('CandidateProfile', { candidateId });
  const topRow = (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: 20,
        rowGap: 4,
      }}
    >
      <GoBackLink
        href={`/candidates/${candidateId}`}
        onPress={onPublic}
        mobile={isMobile}
        pressedColor="#000000"
        style={{ minHeight: 44, marginBottom: 0 }}
      />
      <CandidateLink
        internal
        textSize={16}
        url={`/candidates/${candidateId}`}
        label="View public profile"
        onPress={onPublic}
      />
    </View>
  );
  const statusHeading = (title: string, body: string, kind: 'warning' | 'admin') => (
    <View style={{ marginTop: 14 }}>
      <CandidateStatusHeading headingRef={accessHeadingRef} title={title} body={body} kind={kind} />
    </View>
  );
  if (givenUp)
    return (
      <>
        {topRow}
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
          <View style={{ marginTop: 2 }}>
            <CandidateStatusIcon kind="success" size={19} />
          </View>
          <Text
            style={[
              candidateText.body,
              { color: '#0b4f2c', fontWeight: '600', flex: 1, lineHeight: 24.8 },
            ]}
          >
            {copy.givenUp}
            {givenUp.removed ? copy.givenUpRemoved : ''}
          </Text>
        </View>
        <CandidateAccountIdentity record={record} marginTop={20} />
        <ActionRow>
          <PublicProfileLink candidateId={candidateId} onPublic={onPublic} />
        </ActionRow>
      </>
    );
  if (!claims && loading)
    return (
      <>
        {topRow}
        <CandidateAccountIdentity record={record} marginTop={20} />
        <View
          role="status"
          style={{ marginTop: 26, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Spinner />
          <Text style={[candidateText.strong, { color: '#4f5651' }]}>{copy.loading}</Text>
        </View>
      </>
    );
  if (!claims && failure)
    return (
      <>
        {topRow}
        <CandidateAccountIdentity record={record} marginTop={20} />
        <View role="alert" style={[claimStyles.greyBox, { marginTop: 26 }]}>
          <Text style={[candidateText.strong, { fontWeight: '800' }]}>{copy.failed}</Text>
          <ProfileClaimButton
            label="Try again"
            onPress={() => void load()}
            style={{ minHeight: 44 }}
          />
        </View>
      </>
    );
  if (claims?.is_admin)
    return (
      <>
        {topRow}
        <AdminBlock
          candidateId={candidateId}
          onAdmin={() => navigation.navigate('AdminCandidateClaims', { candidateId })}
        />
      </>
    );
  if (failure === 'give')
    return (
      <>
        {topRow}
        <PageHeading marginTop={10}>Manage this profile</PageHeading>
        <Lead>{copy.manageIntro}</Lead>
        <CandidateAccountIdentity record={record} marginTop={20} />
        <View style={{ marginTop: 22 }}>
          <UnknownBox message={copy.giveUnknown} />
          <View style={{ marginTop: 14 }}>
            <ProfileClaimButton
              label="Reload profile claim status"
              busy={loading}
              busyLabel="Loading profile claim status…"
              width={isMobile ? '100%' : undefined}
              onPress={() => void load()}
            />
          </View>
        </View>
      </>
    );
  if (!canManage) {
    const closed = claim?.election_ended ?? record.electionEnded === true;
    const sourceBlocked = claims?.request_eligibility?.reason === 'official_record_unavailable';
    const block = claimAccountBlock(claims?.request_eligibility?.reason);
    return (
      <>
        {topRow}
        {claim?.status === 'revoked'
          ? statusHeading('Profile claim revoked', copy.manageRevoked, 'warning')
          : statusHeading(
              claim?.status === 'pending'
                ? 'Profile claim request received'
                : claim?.status === 'rejected'
                  ? 'Profile claim not approved'
                  : claim?.status === 'withdrawn'
                    ? 'Profile claim request withdrawn'
                    : claim?.status === 'approved'
                      ? 'Profile claim approved'
                      : 'Profile claim required',
              (sourceBlocked ? null : block) ??
                (claim?.status === 'pending'
                  ? copy.received
                  : claim?.status === 'rejected'
                    ? closed
                      ? copy.rejectedClosed
                      : copy.rejectedOpen
                    : claim?.status === 'withdrawn'
                      ? closed
                        ? copy.claimsClosed
                        : copy.withdrawnOpen
                      : copy.claim),
              'warning',
            )}
        <CandidateAccountIdentity record={record} marginTop={20} />
        {sourceBlocked && claim && claim.status !== 'pending' && !closed ? (
          <View style={{ marginTop: 22 }}>
            <SourceBlockedBox />
          </View>
        ) : null}
        <ActionRow>
          {claim?.can_request_review && claims?.request_eligibility?.allowed ? (
            <LinkButton
              kind="outline"
              label={
                claim.status === 'withdrawn' ? 'Start a new request' : 'Request another review'
              }
              href={`/candidates/${candidateId}/claim`}
              onPress={goClaim}
            />
          ) : claim && claim.status === 'pending' ? (
            <LinkButton
              kind="outline"
              label="View profile claim status"
              href={`/candidates/${candidateId}/claim`}
              onPress={goClaim}
            />
          ) : !claim && claims?.request_eligibility?.allowed ? (
            <LinkButton
              label={copy.claimLabel}
              href={`/candidates/${candidateId}/claim`}
              onPress={goClaim}
            />
          ) : null}
          <PublicProfileLink candidateId={candidateId} onPublic={onPublic} />
        </ActionRow>
      </>
    );
  }
  const okMessage = ['Statement published', 'Changes saved', 'Statement removed'].includes(message)
    ? message
    : '';
  const dateLine = statementDateLine(loaded?.statement);
  const slot = fieldError
    ? {
        kind: 'error' as const,
        text: fieldError === 'empty' ? copy.statementEmpty : copy.statementTooLong,
      }
    : okMessage
      ? { kind: 'ok' as const, text: okMessage }
      : published
        ? dateLine && !changedElsewhere
          ? { kind: 'date' as const, text: dateLine }
          : null
        : { kind: 'guidance' as const, text: copy.notSavedUntilPublished };
  const inert = Boolean(busy) || loading;
  // Design's measured recovery-group spacing, top / sides / bottom, per band.
  const [groupPad, boxPad] = isMobile
    ? [
        [14, 14, 16],
        [14, 16, 16],
      ]
    : isDesktop
      ? [
          [18, 20, 20],
          [16, 20, 18],
        ]
      : [
          [16, 18, 18],
          [16, 18, 18],
        ];
  const recoverySpacing = {
    group: { paddingTop: groupPad[0], paddingHorizontal: groupPad[1], paddingBottom: groupPad[2] },
    box: { paddingTop: boxPad[0], paddingHorizontal: boxPad[1], paddingBottom: boxPad[2] },
  };
  return (
    <>
      {topRow}
      <PageHeading marginTop={10}>Manage this profile</PageHeading>
      <Lead>{copy.manageIntro}</Lead>
      <CandidateAccountIdentity record={record} verified marginTop={20} />
      <View style={{ marginTop: 28 }}>
        <Text
          nativeID="campaign-statement-label"
          accessibilityRole="header"
          aria-level={2}
          style={[
            candidateText.title,
            { fontSize: h2, lineHeight: h2 * 1.3, letterSpacing: h2 * -0.01 },
          ]}
        >
          Campaign statement
        </Text>
        <Text
          nativeID="campaign-statement-help"
          style={[
            candidateText.body,
            { marginTop: 10, fontSize: 15.5, lineHeight: 23.25 },
            web({ textWrap: 'pretty' }),
          ]}
        >
          {published ? copy.statementGuidancePublished : copy.statementGuidance}
        </Text>
        {changedElsewhere ? (
          <View
            role="group"
            aria-labelledby="statement-changed-message"
            style={[claimStyles.changedGroup, recoverySpacing.group]}
          >
            <Text
              nativeID="statement-changed-message"
              style={[
                candidateText.strong,
                { fontSize: 15.5, lineHeight: 23.25, fontWeight: '800', color: '#11150f' },
                web({ outlineStyle: 'none' }),
              ]}
            >
              {copy.changedElsewhere}
            </Text>
            <View style={[claimStyles.currentStatement, recoverySpacing.box]}>
              <View style={claimStyles.currentStatementTop}>
                <Text style={[candidateText.strong, { fontSize: 15.5, lineHeight: 22 }]}>
                  {copy.currentStatement}
                </Text>
                {published && dateLine ? (
                  <Text
                    style={[
                      candidateText.body,
                      { fontSize: 14.5, lineHeight: 21, fontWeight: '600' },
                      web({ fontVariant: ['tabular-nums'] }),
                    ]}
                  >
                    {dateLine}
                  </Text>
                ) : null}
              </View>
              <Text
                style={[
                  candidateText.body,
                  { marginTop: 8, color: '#2c322c', fontSize: 16, lineHeight: 26.4 },
                  web({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }),
                ]}
              >
                {published ? publicBody : copy.noCurrentStatement}
              </Text>
            </View>
          </View>
        ) : null}
        <ManageEditor
          editorRef={editorRef}
          value={draft}
          invalid={Boolean(fieldError)}
          readOnly={inert}
          onChange={(value) => {
            setDraft(value);
            setMessage('');
            if (fieldError) setFieldError(check(published ? 'save' : 'publish', value));
          }}
        />
        <View
          style={{
            marginTop: 8,
            minHeight: 22,
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            columnGap: 16,
            rowGap: 6,
          }}
        >
          <View
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0 }}
            aria-live="polite"
          >
            {slot?.kind === 'error' ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ marginTop: 1 }}>
                  <FieldErrorIcon />
                </View>
                <Text
                  nativeID="campaign-statement-slot"
                  style={[
                    candidateText.strong,
                    { flex: 1, fontSize: 15, lineHeight: 21.75, color: '#a3421a' },
                  ]}
                >
                  {slot.text}
                </Text>
              </View>
            ) : slot?.kind === 'ok' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <CandidateStatusIcon kind="success" size={17} />
                <Text
                  nativeID="campaign-statement-slot"
                  style={[
                    candidateText.strong,
                    { fontSize: 15, lineHeight: 21.75, color: '#0f5d36' },
                  ]}
                >
                  {slot.text}
                </Text>
              </View>
            ) : slot ? (
              <Text
                nativeID="campaign-statement-slot"
                style={[
                  candidateText.body,
                  slot.kind === 'date'
                    ? {
                        fontSize: 14.5,
                        lineHeight: 21,
                        fontWeight: '600',
                        fontVariant: ['tabular-nums'],
                      }
                    : { fontSize: 15, lineHeight: 21.75 },
                ]}
              >
                {slot.text}
              </Text>
            ) : null}
          </View>
          <Text
            nativeID="campaign-statement-count"
            style={[
              candidateText.body,
              {
                marginLeft: 'auto',
                fontSize: 14.5,
                lineHeight: 21,
                fontWeight: '600',
                fontVariant: ['tabular-nums'],
                color: characters > 2000 ? '#a3421a' : '#4f5651',
              },
              web({ whiteSpace: 'nowrap' }),
            ]}
          >
            {characters} / 2000 characters
          </Text>
        </View>
        {failure === 'write' || busy === 'checking' ? (
          <View role="alert" style={[claimStyles.writeFailure]}>
            <Text style={[candidateText.strong, { fontSize: 15.5, fontWeight: '800' }]}>
              {copy.writeFailed}
            </Text>
            <ProfileClaimButton
              label="Try again"
              busyLabel="Checking…"
              busy={busy === 'checking'}
              unavailable={Boolean(busy) && busy !== 'checking'}
              style={{ minHeight: 44, fontSize: 15, padding: '10px 18px' }}
              onPress={() => void retry()}
            />
            <Text style={visuallyHidden as unknown as TextStyle} aria-live="polite">
              {busy === 'checking' ? copy.checking : ''}
            </Text>
          </View>
        ) : null}
        <View
          style={[
            candidateAccountStyles.actions,
            { marginTop: 24 },
            isMobile && { flexDirection: 'column', alignItems: 'stretch' },
          ]}
        >
          <ProfileClaimButton
            label="Preview"
            expanded={preview}
            controls="campaign-statement-preview"
            unavailable={inert}
            width={isMobile ? '100%' : undefined}
            onPress={() => setPreview((value) => !value)}
          />
          {!published ? (
            <ProfileClaimButton
              label="Publish statement"
              busyLabel="Publishing…"
              busy={busy === 'publish'}
              unavailable={inert && busy !== 'publish'}
              kind="green"
              width={isMobile ? '100%' : undefined}
              onPress={() => void write('publish')}
            />
          ) : dirty || busy === 'save' ? (
            <ProfileClaimButton
              label="Save changes"
              busyLabel="Saving…"
              busy={busy === 'save'}
              unavailable={inert && busy !== 'save'}
              kind="green"
              width={isMobile ? '100%' : undefined}
              onPress={() => void write('save')}
            />
          ) : null}
          {published && busy !== 'publish' ? (
            <View ref={removeRef} style={{ marginLeft: isMobile ? 0 : 'auto' }}>
              <ProfileClaimButton
                label="Remove statement"
                kind="danger-text"
                unavailable={inert}
                width={isMobile ? '100%' : undefined}
                onPress={() => setDialog('remove')}
              />
            </View>
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
                {
                  paddingHorizontal: 4,
                  paddingBottom: 10,
                  fontSize: 10.5,
                  letterSpacing: 1.26,
                  color: '#4f5651',
                },
              ]}
            >
              PREVIEW
            </Text>
            <CandidateCampaignStatement
              preview
              record={record}
              statement={{
                body: draft,
                updated_at: loaded?.statement?.updated_at ?? null,
                version: loaded?.statement?.version ?? 0,
                // A draft that differs from the public text has no publication date yet.
                published_at: published && !dirty ? loaded?.statement?.published_at : null,
                edited_at: published && !dirty ? loaded?.statement?.edited_at : null,
              }}
            />
          </View>
        ) : null}
      </View>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: 'rgba(17,21,15,.1)',
          marginTop: 34,
          paddingTop: 22,
          maxWidth: 600,
          gap: 8,
          alignItems: isMobile ? 'stretch' : 'flex-start',
        }}
      >
        <View ref={giveUpRef}>
          <ProfileClaimButton
            label="Give up this profile claim"
            kind="danger"
            describedBy="profile-claim-give-up-help"
            unavailable={inert}
            width={isMobile ? '100%' : undefined}
            onPress={() => setDialog('withdraw')}
          />
        </View>
        <Text
          nativeID="profile-claim-give-up-help"
          style={[
            candidateText.body,
            { fontSize: 15, lineHeight: 22.5 },
            web({ textWrap: 'pretty' }),
          ]}
        >
          {published ? copy.giveUpPublished : copy.giveUpUnpublished}
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
                {profileClaimDate(revision.created_at)}
              </Text>
              {revision.body ? <Text style={candidateText.body}>{revision.body}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {dialog === 'withdraw' ? (
        <CandidateDialog
          title="Give up this profile claim?"
          subtitle={record.candidate.name}
          onClose={() => {
            if (busy !== 'withdraw') setDialog(null);
          }}
          returnFocus={focusButtonIn(giveUpRef)}
          actions={
            <CandidateDialogActions equal>
              <ProfileClaimButton
                label="Keep profile claim"
                kind="green"
                disabled={busy === 'withdraw'}
                width="100%"
                style={{ alignSelf: 'stretch' }}
                onPress={() => setDialog(null)}
              />
              <ProfileClaimButton
                label="Give up profile claim"
                busyLabel="Giving up profile claim…"
                busy={busy === 'withdraw'}
                kind="danger"
                width="100%"
                style={{ alignSelf: 'stretch' }}
                onPress={() => void giveUp()}
              />
            </CandidateDialogActions>
          }
        >
          <Text style={[candidateText.body, { color: '#2c322c', lineHeight: 24.8 }]}>
            {published ? copy.giveUpBodyPublished : copy.giveUpBodyUnpublished}
          </Text>
          {dirty ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ marginTop: 2 }}>
                <CandidateStatusIcon kind="warning" size={17} />
              </View>
              <Text
                style={[
                  candidateText.strong,
                  { flex: 1, fontSize: 15.5, lineHeight: 23.25, color: '#8f5a12' },
                ]}
              >
                {copy.giveUpUnsaved}
              </Text>
            </View>
          ) : null}
        </CandidateDialog>
      ) : dialog ? (
        <CandidateDialog
          title={
            dialog === 'remove'
              ? 'Remove your statement from the public profile?'
              : 'You have unsaved changes'
          }
          onClose={() => {
            if (!busy) {
              if (dialog === 'leave') keepEditing();
              else setDialog(null);
            }
          }}
          returnFocus={dialog === 'leave' ? focusEditor : focusButtonIn(removeRef, focusEditor)}
          actions={
            <CandidateDialogActions equal>
              <ProfileClaimButton
                kind="green"
                width="100%"
                style={{ alignSelf: 'stretch' }}
                label={dialog === 'remove' ? 'Keep statement' : 'Keep editing'}
                disabled={Boolean(busy)}
                onPress={() => (dialog === 'leave' ? keepEditing() : setDialog(null))}
              />
              <ProfileClaimButton
                label={dialog === 'remove' ? 'Remove statement' : 'Discard changes'}
                busyLabel={dialog === 'remove' ? 'Removing statement…' : undefined}
                busy={busy === 'remove'}
                width="100%"
                style={{ alignSelf: 'stretch' }}
                kind="danger"
                onPress={() => (dialog === 'leave' ? setDiscarding(true) : void write('remove'))}
              />
            </CandidateDialogActions>
          }
        >
          {dialog === 'remove' ? (
            <Text style={[candidateText.body, { color: '#2c322c', lineHeight: 24.8 }]}>
              {copy.removeBody}
            </Text>
          ) : null}
        </CandidateDialog>
      ) : null}
    </>
  );
}
function ManageEditor({
  editorRef,
  value,
  invalid,
  readOnly,
  onChange,
}: {
  editorRef: RefObject<TextInput | null>;
  value: string;
  invalid: boolean;
  readOnly: boolean;
  onChange(value: string): void;
}) {
  return (
    <CandidateField
      label="Campaign statement"
      hideLabel
      inputRef={editorRef}
      labelledBy="campaign-statement-label"
      describedBy="campaign-statement-slot campaign-statement-help campaign-statement-count"
      invalid={invalid}
      inputStyle={[
        {
          marginTop: 14,
          minHeight: 136,
          paddingVertical: 14,
          paddingHorizontal: 16,
          fontSize: 16.5,
          lineHeight: 26.4,
        },
        web({ resize: 'vertical', maxHeight: 520, overflowY: 'auto' }) ?? {},
        readOnly ? { opacity: 0.7 } : null,
      ]}
      value={value}
      onChange={onChange}
      multiline
      readOnly={readOnly}
    />
  );
}
function AdminBlock({ candidateId, onAdmin }: { candidateId: string; onAdmin(): void }) {
  const { isMobile, status, lead } = useBands();
  return (
    <>
      <View style={{ marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <View
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#f1f2f4',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LockIcon size={22} />
        </View>
        <Text
          accessibilityRole="header"
          aria-level={1}
          style={[
            candidateText.title,
            {
              flex: 1,
              marginTop: 2,
              fontSize: status,
              lineHeight: status * 1.12,
              letterSpacing: status * -0.02,
            },
          ]}
        >
          {copy.adminTitle}
        </Text>
      </View>
      <Text
        style={[
          candidateText.body,
          { marginTop: 12, fontSize: lead, lineHeight: lead * 1.5, color: '#2c322c' },
        ]}
      >
        {copy.adminBody}
      </Text>
      <View style={{ marginTop: 22, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        <LinkButton
          kind="outline"
          label="Review profile claim requests"
          href={`/admin/candidate-claims?candidate=${encodeURIComponent(candidateId)}`}
          onPress={onAdmin}
        />
      </View>
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
  const title = mode === 'claim' ? copy.claimLabel : 'Manage this profile';
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
  const onPublic = () => navigation.navigate('CandidateProfile', { candidateId: id });
  const onAdmin = () => navigation.navigate('AdminCandidateClaims', { candidateId: id });
  if (error === 'not-found')
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: `/candidates/${id}/${mode}` } } as never}
      />
    );
  const closed = record?.electionEnded === true;
  const signedOutClaim = (current: CandidateProfileRecord) => (
    <>
      <GoBackLink
        href={`/candidates/${id}`}
        onPress={onPublic}
        mobile={isMobile}
        pressedColor="#000000"
        style={{ minHeight: 44, marginBottom: 0 }}
      />
      {closed ? (
        <>
          <ClosedHeading />
          <Lead>{copy.electionEnded}</Lead>
        </>
      ) : (
        <>
          <PageHeading>{copy.claimLabel}</PageHeading>
          <Lead>{copy.intro}</Lead>
          <CandidateLink
            internal
            textSize={16}
            url={candidateFeaturesPath(id)}
            label={copy.featuresLink}
            onPress={() => navigation.navigate('CandidateFeatures', { candidateId: id })}
            style={{ marginTop: 6 }}
          />
        </>
      )}
      <CandidateAccountIdentity record={current} marginTop={closed ? 24 : 18} />
      {closed ? (
        <ActionRow top={24}>
          <AccountSignInButton
            label="Sign in to view claim status"
            onPress={() => openSignIn({ intent: 'nav', returnTo: `/candidates/${id}/claim` })}
          />
          <LinkButton
            kind="outline"
            tall
            label="View public profile"
            href={`/candidates/${id}`}
            onPress={onPublic}
          />
        </ActionRow>
      ) : (
        <>
          <View style={{ marginTop: 24, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
            <AccountSignInButton
              label="Sign in to continue"
              onPress={() => openSignIn({ intent: 'nav', returnTo: `/candidates/${id}/claim` })}
            />
          </View>
          <Text
            style={[
              candidateText.body,
              {
                marginTop: 28,
                paddingTop: 20,
                borderTopWidth: 1,
                borderTopColor: 'rgba(17,21,15,0.1)',
                fontSize: 15,
                lineHeight: 22.5,
              },
              web({ textWrap: 'pretty' }),
            ]}
          >
            {copy.reviewNote}
          </Text>
        </>
      )}
    </>
  );
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <View
          style={{
            paddingHorizontal: isMobile ? 20 : isDesktop ? 40 : 32,
            paddingTop: isMobile ? 18 : isDesktop ? 26 : 24,
            paddingBottom: 56,
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
              mode === 'claim' ? (
                signedOutClaim(record)
              ) : (
                <>
                  <GoBackLink
                    href={`/candidates/${id}`}
                    onPress={onPublic}
                    mobile={isMobile}
                    pressedColor="#000000"
                    style={{ minHeight: 44, marginBottom: 0 }}
                  />
                  <PageHeading marginTop={10}>Manage this profile</PageHeading>
                  <Lead>{copy.manageIntro}</Lead>
                  <CandidateAccountIdentity record={record} marginTop={20} />
                  <View style={{ marginTop: 24, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
                    <AccountSignInButton
                      label="Sign in to continue"
                      onPress={() =>
                        openSignIn({ intent: 'nav', returnTo: `/candidates/${id}/manage` })
                      }
                    />
                  </View>
                </>
              )
            ) : admin.state === 'allowed' ? (
              mode === 'manage' ? (
                <>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      columnGap: 20,
                      rowGap: 4,
                    }}
                  >
                    <GoBackLink
                      href={`/candidates/${id}`}
                      onPress={onPublic}
                      mobile={isMobile}
                      pressedColor="#000000"
                      style={{ minHeight: 44, marginBottom: 0 }}
                    />
                    <CandidateLink
                      internal
                      textSize={16}
                      url={`/candidates/${id}`}
                      label="View public profile"
                      onPress={onPublic}
                    />
                  </View>
                  <AdminBlock candidateId={id} onAdmin={onAdmin} />
                </>
              ) : (
                <>
                  <CandidateAccountIdentity record={record} />
                  <View style={{ marginTop: 26 }}>
                    <CandidateStatusHeading
                      title={copy.adminTitle}
                      body={copy.adminBody}
                      kind="admin"
                    />
                    <ActionRow>
                      <LinkButton
                        kind="outline"
                        label="Review profile claim requests"
                        href={`/admin/candidate-claims?candidate=${encodeURIComponent(id)}`}
                        onPress={onAdmin}
                      />
                      <PublicProfileLink candidateId={id} onPublic={onPublic} />
                    </ActionRow>
                  </View>
                </>
              )
            ) : admin.state === 'loading' || admin.state === 'error' ? (
              <>
                <CandidateAccountIdentity record={record} />
                <View style={{ marginTop: 26 }}>
                  {admin.state === 'error' ? (
                    <View role="alert" style={claimStyles.greyBox}>
                      <Text style={[candidateText.strong, { fontWeight: '800' }]}>
                        {copy.failed}
                      </Text>
                      <ProfileClaimButton
                        label="Try again"
                        onPress={admin.retry}
                        style={{ minHeight: 44 }}
                      />
                    </View>
                  ) : (
                    <View
                      role="status"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}
                    >
                      <Spinner />
                      <Text style={[candidateText.strong, { color: '#4f5651' }]}>
                        {copy.loading}
                      </Text>
                    </View>
                  )}
                  <View style={{ marginTop: 14 }}>
                    <PublicProfileLink candidateId={id} onPublic={onPublic} />
                  </View>
                </View>
              </>
            ) : mode === 'claim' ? (
              <ClaimForm
                key={`${id}:${user.id}`}
                record={record}
                token={accessToken}
                accountKey={user.id}
                onManage={() => navigation.navigate('CandidateManage', { candidateId: id })}
                onAdmin={onAdmin}
                onPublic={onPublic}
                onBack={onPublic}
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
function AccountSignInButton({ label, onPress }: { label: string; onPress(): void }) {
  const { isMobile } = useBands();
  return (
    <CandidateButton
      label={label}
      icon="none"
      fontSize={17}
      textStyle={{ lineHeight: 22.1 }}
      onPress={onPress}
      style={{
        minHeight: 52,
        paddingHorizontal: 26,
        alignSelf: isMobile ? 'stretch' : 'flex-start',
      }}
    />
  );
}
const claimStyles = {
  greyBox: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    columnGap: 16,
    rowGap: 10,
  },
  changedGroup: {
    marginTop: 28,
    backgroundColor: '#fdf6e7',
    borderWidth: 1,
    borderColor: '#efd9a8',
    borderRadius: 14,
  },
  currentStatement: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 12,
  },
  currentStatementTop: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'baseline' as const,
    columnGap: 16,
    rowGap: 2,
  },
  writeFailure: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fdf6e7',
    borderWidth: 1,
    borderColor: '#efd9a8',
    borderRadius: 12,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    columnGap: 16,
    rowGap: 10,
  },
  extraNote: { ...candidateText.body, fontSize: 15.5, lineHeight: 23.25 },
};
export function CandidateClaimScreen(props: RootScreenProps<'CandidateClaim'>) {
  return <CandidateAccountScreen {...props} mode="claim" />;
}
export function CandidateManageScreen(props: RootScreenProps<'CandidateManage'>) {
  return <CandidateAccountScreen {...props} mode="manage" />;
}
