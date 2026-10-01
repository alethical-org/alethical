import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import {
  CandidateAccountIdentity,
  CandidateField,
  CandidateSafeDialog,
  candidateAccountStyles,
} from '../components/candidates/CandidateAccountControls';
import { CandidateCampaignStatement } from '../components/candidates/CandidateClaimPanel';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
  safeCandidateUrl,
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
  type CandidateClaim,
  type CandidateClaimList,
  type PrivateCandidateStatement,
} from '../data/candidateClaims';
import { useResponsive } from '../hooks/useResponsive';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { NotFoundScreen } from './redesign/NotFoundScreen';

const claimHeadings = {
  pending: 'Review pending',
  approved: 'Campaign access verified',
  rejected: 'Not approved',
  revoked: 'Campaign access revoked',
  withdrawn: 'Request withdrawn',
};
function useRequestLifetime() {
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  return () => lifetime.current.signal;
}
function ClaimForm({
  record,
  token,
  onManage,
}: {
  record: CandidateProfileRecord;
  token: string;
  onManage(): void;
}) {
  const signal = useRequestLifetime();
  const { isMobile } = useResponsive();
  const [response, setResponse] = useState<CandidateClaimList | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [role, setRole] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [validation, setValidation] = useState('');
  const roles = useRef<HTMLFieldSetElement>(null);
  const current = response?.claims.find((item) => item.candidate_id === record.candidate.id);
  const load = async () => {
    const scope = signal();
    try {
      const result = await getMyCandidateClaims(token, record.candidate.id, scope);
      if (!scope.aborted) {
        setResponse(result);
        setFailed(false);
      }
    } catch {
      if (!scope.aborted) setFailed(true);
    }
  };
  useEffect(() => {
    void load();
  }, [attempt]);
  const submit = async () => {
    if (busy || !response) return;
    if (!role || !safeCandidateUrl(evidence.trim()) || note.trim().length < 20) {
      if (!role) roles.current?.focus();
      setValidation(
        'Choose your role, add a public campaign or official record link, and explain your authority in at least 20 characters',
      );
      return;
    }
    const scope = signal();
    setBusy(true);
    setFailed(false);
    setValidation('');
    try {
      await requestCandidateClaim(
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
        await load();
      }
    } catch {
      if (!scope.aborted) setFailed(true);
    } finally {
      if (!scope.aborted) setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!current || !response || busy) return;
    const scope = signal();
    setBusy(true);
    try {
      await withdrawCandidateClaim(
        token,
        current.id,
        { expected_account_id: response.account_id, expected_version: current.version },
        scope,
      );
      if (!scope.aborted) await load();
    } catch {
      if (!scope.aborted) setFailed(true);
    } finally {
      if (!scope.aborted) setBusy(false);
    }
  };
  if (!response && !failed)
    return (
      <Text accessibilityLiveRegion="polite" style={candidateText.body}>
        Loading claim status…
      </Text>
    );
  return (
    <View style={{ marginTop: 22, gap: 18 }}>
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>We couldn’t complete this request</Text>
          <CandidateButton
            label="Try again"
            kind="outline"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </CandidateNotice>
      ) : null}
      {current && !formOpen ? (
        <View style={candidateAccountStyles.identity}>
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[candidateText.title, { fontSize: 22 }]}
          >
            {claimHeadings[current.status]}
          </Text>
          {current.status === 'approved' ? (
            <>
              <Text style={candidateText.body}>
                Alethical confirmed this account’s authority to manage campaign content
              </Text>
              <CandidateLink
                internal
                label="Manage this profile"
                url={`/candidates/${record.candidate.id}/manage`}
                onPress={onManage}
              />
            </>
          ) : current.status === 'pending' ? (
            <>
              <Text style={candidateText.body}>Your request is waiting for independent review</Text>
              <Text style={candidateText.body}>{current.request_note}</Text>
              <CandidateButton
                kind="outline"
                label="Withdraw request"
                busy={busy}
                onPress={() => void withdraw()}
              />
            </>
          ) : (
            <CandidateButton
              label="Request a review"
              icon="none"
              onPress={() => setFormOpen(true)}
            />
          )}
        </View>
      ) : response ? (
        <>
          <CandidateAccountIdentity record={record} />
          <fieldset ref={roles} tabIndex={-1} style={{ margin: 0, border: 0, padding: 0 }}>
            <legend
              style={{ fontFamily: candidateText.body.fontFamily, fontSize: 16, fontWeight: 700 }}
            >
              Your role
            </legend>
            <View style={{ marginTop: 10, gap: 8, flexDirection: isMobile ? 'column' : 'row' }}>
              {['Candidate', 'Authorized campaign representative'].map((label) => (
                <label
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 52,
                    padding: '0 14px',
                    border: `1px solid ${role === label ? '#2ed47e' : 'rgba(17,21,15,0.16)'}`,
                    background: role === label ? '#f2fbf6' : '#fff',
                    borderRadius: 12,
                    fontFamily: candidateText.body.fontFamily,
                    fontSize: 15.5,
                  }}
                >
                  <input
                    type="radio"
                    name="candidate-role"
                    checked={role === label}
                    onChange={() => setRole(label)}
                    disabled={busy}
                  />
                  {label}
                </label>
              ))}
            </View>
          </fieldset>
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[candidateText.title, { fontSize: 22 }]}
          >
            Request manual review
          </Text>
          <Text style={candidateText.body}>
            A filing record or certificate supports review but does not prove your identity
          </Text>
          <CandidateField
            label="Supporting record URL"
            value={evidence}
            onChange={setEvidence}
            readOnly={busy}
            maxLength={2000}
          />
          <CandidateField
            label="Explain your authority to represent this campaign"
            value={note}
            onChange={setNote}
            multiline
            readOnly={busy}
            maxLength={1900}
          />
          {validation ? (
            <Text role="alert" style={candidateText.strong}>
              {validation}
            </Text>
          ) : null}
          <CandidateButton
            label="Submit for review"
            icon="none"
            busy={busy}
            onPress={() => void submit()}
            style={{ width: isMobile ? '100%' : 248 }}
          />
        </>
      ) : null}
    </View>
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
  const [claim, setClaim] = useState<CandidateClaim | null>(null);
  const [loaded, setLoaded] = useState<PrivateCandidateStatement | null>(null);
  const [draft, setDraft] = useState('');
  const [initialised, setInitialised] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'withdraw' | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<'remove' | 'leave' | 'withdraw' | null>(null);
  const [leaveAction, setLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const publicBody = loaded?.statement?.body ?? '';
  const dirty = initialised && draft !== publicBody;
  const load = async (recover = false) => {
    const scope = signal();
    try {
      const mine = await getMyCandidateClaims(token, record.candidate.id, scope);
      const access = mine.claims.find((item) => item.candidate_id === record.candidate.id) ?? null;
      const statement = access ? await getPrivateCandidateStatement(token, access.id, scope) : null;
      if (!scope.aborted) {
        setClaims(mine);
        setClaim(access);
        setLoaded(statement);
        setFailed(false);
        if (recover) setRecovered(true);
        if (!initialised && statement) {
          setDraft(statement.statement?.body ?? '');
          setInitialised(true);
        }
      }
    } catch {
      if (!scope.aborted) setFailed(true);
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
    if (!claim || !claims || busy || failed) return;
    const scope = signal();
    setBusy(action);
    setMessage('');
    setDialog(null);
    try {
      if (action === 'withdraw') {
        await withdrawCandidateClaim(
          token,
          claim.id,
          { expected_account_id: claims.account_id, expected_version: claim.version },
          scope,
        );
        if (!scope.aborted) {
          setDraft('');
          setInitialised(false);
          await load();
        }
      } else {
        const identity = {
          expected_account_id: claims.account_id,
          expected_version: loaded?.statement?.version ?? 0,
        };
        if (action === 'remove') await removeCandidateStatement(token, claim.id, identity, scope);
        else await saveCandidateStatement(token, claim.id, { ...identity, body: draft }, scope);
        if (!scope.aborted) {
          const next = await getPrivateCandidateStatement(token, claim.id, scope);
          if (!scope.aborted) {
            setLoaded(next);
            setDraft(next.statement?.body ?? '');
            setMessage(
              action === 'remove'
                ? 'Statement removed'
                : publicBody
                  ? 'Changes saved'
                  : 'Statement published',
            );
          }
        }
      }
    } catch {
      if (!scope.aborted) setFailed(true);
    } finally {
      if (!scope.aborted) setBusy(null);
    }
  };
  return (
    <>
      <CandidateAccountIdentity record={record} />
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>We couldn’t complete this request</Text>
          <Text style={candidateText.body}>Try again reads what is public before another save</Text>
          <CandidateButton label="Try again" kind="outline" onPress={() => void load(true)} />
        </CandidateNotice>
      ) : null}
      {recovered && loaded ? (
        <View style={{ marginTop: 20 }}>
          <Text style={candidateText.strong}>Current public statement</Text>
          {loaded.statement?.body ? (
            <CandidateCampaignStatement record={record} statement={loaded.statement} />
          ) : (
            <Text style={candidateText.body}>No campaign statement is public</Text>
          )}
        </View>
      ) : null}
      {!claims && !failed ? (
        <Text accessibilityLiveRegion="polite" style={candidateText.body}>
          Loading campaign access…
        </Text>
      ) : claim?.status === 'approved' && loaded ? (
        <>
          <View style={{ marginTop: 18, gap: 2 }}>
            <Text style={candidateText.strong}>Campaign access verified</Text>
            <Text style={candidateText.body}>
              Alethical confirmed this account’s authority to manage campaign content
            </Text>
          </View>
          <View style={{ marginTop: 28, gap: 8 }}>
            <Text style={candidateText.body}>
              Explain your record or add context in your own words
            </Text>
            <Text style={candidateText.strong}>
              Your statement appears separately from official records
            </Text>
            <CandidateField
              label="Campaign statement"
              value={draft}
              onChange={(value) => {
                setDraft(value);
                setMessage('');
              }}
              multiline
              readOnly={Boolean(busy)}
            />
          </View>
          <View accessibilityLiveRegion="polite" style={{ minHeight: 24, marginTop: 12 }}>
            <Text style={candidateText.strong}>{message}</Text>
          </View>
          <View
            style={[
              candidateAccountStyles.actions,
              isMobile && { flexDirection: 'column', alignItems: 'stretch' },
            ]}
          >
            <CandidateButton
              label="Preview"
              kind="outline"
              disabled={Boolean(busy)}
              onPress={() => setPreview((value) => !value)}
              style={isMobile && { width: '100%' }}
            />
            {dirty || busy === 'save' ? (
              <CandidateButton
                label={
                  busy === 'save'
                    ? publicBody
                      ? 'Saving…'
                      : 'Publishing…'
                    : publicBody
                      ? 'Save changes'
                      : 'Publish statement'
                }
                busy={busy === 'save'}
                disabled={Boolean(busy) || failed}
                icon="none"
                onPress={() => void write('save')}
                style={{ width: isMobile ? '100%' : 220 }}
              />
            ) : !publicBody ? (
              <CandidateButton
                label="Publish statement"
                disabled
                icon="none"
                onPress={() => {}}
                style={{ width: isMobile ? '100%' : 220 }}
              />
            ) : null}
            {publicBody ? (
              <CandidateButton
                label="Remove statement"
                kind="text"
                disabled={Boolean(busy) || failed}
                busy={busy === 'remove'}
                onPress={() => setDialog('remove')}
                style={isMobile ? { width: '100%' } : { marginLeft: 'auto' }}
              />
            ) : null}
          </View>
          {preview ? (
            <View style={{ marginTop: 22 }}>
              <Text style={candidateText.strong}>PREVIEW</Text>
              <CandidateCampaignStatement
                record={record}
                statement={{
                  body: draft,
                  updated_at: loaded.statement?.updated_at ?? new Date().toISOString(),
                  version: loaded.statement?.version ?? 0,
                }}
              />
            </View>
          ) : null}
          <CandidateButton
            label="Relinquish campaign access"
            kind="text"
            disabled={Boolean(busy)}
            onPress={() => setDialog('withdraw')}
            style={{ marginTop: 24 }}
          />
        </>
      ) : claims ? (
        <View style={{ marginTop: 22, gap: 12 }}>
          <Text style={candidateText.strong}>
            {claim
              ? claimHeadings[claim.status]
              : 'Campaign access has not been verified for this account'}
          </Text>
          <CandidateLink
            internal
            label="Request a review"
            url={`/candidates/${record.candidate.id}/claim`}
            onPress={() =>
              navigation.navigate('CandidateClaim', { candidateId: record.candidate.id })
            }
          />
        </View>
      ) : null}
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
      <Text style={[candidateText.body, { marginTop: 32 }]}>
        Explanations attached to individual votes and paid campaign services are not available yet
      </Text>
      {dialog ? (
        <CandidateSafeDialog
          title={
            dialog === 'remove'
              ? 'Remove your statement from the public profile?'
              : dialog === 'withdraw'
                ? 'Relinquish campaign access and remove your statement?'
                : 'You have unsaved changes'
          }
          safe={
            dialog === 'remove'
              ? 'Keep statement'
              : dialog === 'withdraw'
                ? 'Keep campaign access'
                : 'Keep editing'
          }
          risky={
            dialog === 'remove'
              ? 'Remove statement'
              : dialog === 'withdraw'
                ? 'Relinquish access'
                : 'Discard changes'
          }
          onSafe={() => setDialog(null)}
          onRisky={() => (dialog === 'leave' ? setDiscarding(true) : void write(dialog))}
        />
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
  const title = mode === 'claim' ? 'Claim this profile' : 'Manage campaign content';
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
            paddingHorizontal: isMobile ? 20 : isDesktop ? 56 : 32,
            paddingTop: 40,
            paddingBottom: 64,
          }}
        >
          <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', gap: 14 }}>
            <CandidateLink
              internal
              url={`/candidates/${id}`}
              label="View public profile"
              onPress={() => navigation.navigate('CandidateProfile', { candidateId: id })}
            />
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                { fontSize: isMobile ? 32 : 44, lineHeight: isMobile ? 39 : 51 },
              ]}
            >
              {title}
            </Text>
            {mode === 'claim' ? (
              <Text style={candidateText.body}>
                Confirm that you are the candidate or are authorized to represent the campaign
              </Text>
            ) : null}
            {isLoading ? (
              <Text accessibilityLiveRegion="polite" style={candidateText.body}>
                Loading account…
              </Text>
            ) : !isSignedIn || !user || !accessToken ? (
              <CandidateButton
                label="Sign in to continue"
                icon="none"
                onPress={() => openSignIn({ intent: 'nav', returnTo: `/candidates/${id}/${mode}` })}
              />
            ) : error ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>Candidate record is unavailable</Text>
                <CandidateButton
                  label="Try again"
                  kind="outline"
                  onPress={() => setAttempt((value) => value + 1)}
                />
              </CandidateNotice>
            ) : record?.candidate.id === id ? (
              mode === 'claim' ? (
                <ClaimForm
                  key={`${id}:${user.id}`}
                  record={record}
                  token={accessToken}
                  onManage={() => navigation.navigate('CandidateManage', { candidateId: id })}
                />
              ) : (
                <ManageContent
                  key={`${id}:${user.id}`}
                  record={record}
                  token={accessToken}
                  navigation={navigation as never}
                />
              )
            ) : (
              <Text accessibilityLiveRegion="polite" style={candidateText.body}>
                Loading candidate record…
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
export function CandidateClaimScreen(props: RootScreenProps<'CandidateClaim'>) {
  return <CandidateAccountScreen {...props} mode="claim" />;
}
export function CandidateManageScreen(props: RootScreenProps<'CandidateManage'>) {
  return <CandidateAccountScreen {...props} mode="manage" />;
}
