import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
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
import {
  getAdminCandidateClaims,
  getCandidateStatementReports,
  reviewCandidateClaim,
  resolveCandidateStatementReport,
  type CandidateClaim,
  type CandidateClaimList,
  type CandidateStatementReports,
} from '../data/candidateClaims';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { useResponsive } from '../hooks/useResponsive';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { Footer, PageBackground, TopNav } from '../theme/primitives';

function ReviewRow({
  claim,
  token,
  accountId,
  onDone,
  disabled,
}: {
  claim: CandidateClaim;
  token: string;
  accountId: string;
  onDone(): void;
  disabled: boolean;
}) {
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const review = async (action: 'approve' | 'reject' | 'revoke') => {
    if (
      busy ||
      disabled ||
      note.trim().length < 20 ||
      (action === 'approve' && (!verified || (claim.user_id ?? claim.account_id) === accountId))
    )
      return;
    const scope = new AbortController();
    controller.current = scope;
    setBusy(true);
    setFailed(false);
    try {
      await reviewCandidateClaim(
        token,
        claim.id,
        {
          action,
          review_note: note.trim(),
          identity_verified: verified,
          expected_version: claim.version,
          expected_account_id: accountId,
        },
        scope.signal,
      );
      if (!scope.signal.aborted) onDone();
    } catch {
      if (!scope.signal.aborted) setFailed(true);
    } finally {
      if (!scope.signal.aborted) setBusy(false);
    }
  };
  return (
    <View style={[candidateAccountStyles.identity, { gap: 12 }]}>
      <CandidateLink
        internal
        label={claim.candidate_name}
        url={`/candidates/${claim.candidate_id}`}
      />
      <Text style={candidateText.body}>{claim.office}</Text>
      <Text style={candidateText.body}>
        Applicant account: {claim.account_email ?? 'No email available'}
      </Text>
      <Text style={candidateText.strong}>Request status: {claim.status}</Text>
      {safeCandidateUrl(claim.evidence_url) ? (
        <CandidateLink label="Supporting record" url={claim.evidence_url} />
      ) : null}
      <Text style={candidateText.body}>{claim.request_note}</Text>
      {claim.review_note ? (
        <Text style={candidateText.body}>Review note: {claim.review_note}</Text>
      ) : null}
      <CandidateField
        label={`Review note for ${claim.candidate_name}`}
        value={note}
        onChange={setNote}
        multiline
        readOnly={busy || disabled}
      />
      <Text style={candidateText.body}>
        Use at least 20 characters. A filing or verified login alone does not prove campaign
        authority.
      </Text>
      {claim.status === 'pending' ? (
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            fontFamily: candidateText.body.fontFamily,
            fontSize: 15,
            lineHeight: '24px',
            minHeight: 44,
          }}
        >
          <input
            type="checkbox"
            checked={verified}
            disabled={busy || disabled}
            onChange={(event) => setVerified(event.target.checked)}
          />
          I independently verified this applicant’s identity and authority to represent this
          campaign
        </label>
      ) : null}
      {(claim.user_id ?? claim.account_id) === accountId ? (
        <Text style={candidateText.body}>You cannot approve your own request</Text>
      ) : null}
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>
            Review could not be saved. Refresh the queue before trying again.
          </Text>
          <CandidateButton label="Refresh queue" kind="outline" onPress={onDone} />
        </CandidateNotice>
      ) : null}
      <View style={candidateAccountStyles.actions}>
        {claim.status === 'pending' ? (
          <>
            <CandidateButton
              label="Approve request"
              icon="none"
              busy={busy}
              disabled={
                disabled ||
                !verified ||
                note.trim().length < 20 ||
                (claim.user_id ?? claim.account_id) === accountId ||
                failed
              }
              onPress={() => void review('approve')}
            />
            <CandidateButton
              label="Reject request"
              kind="outline"
              busy={busy}
              disabled={disabled || note.trim().length < 20 || failed}
              onPress={() => void review('reject')}
            />
          </>
        ) : claim.status === 'approved' ? (
          <CandidateButton
            label="Revoke campaign access"
            kind="outline"
            busy={busy}
            disabled={disabled || note.trim().length < 20 || failed}
            onPress={() => void review('revoke')}
          />
        ) : null}
      </View>
    </View>
  );
}
function ClaimsQueue({ token }: { token: string }) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    filter: string;
    offset: number;
    result: CandidateClaimList;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    void getAdminCandidateClaims(token, filter, controller.signal, offset)
      .then(
        (result) => {
          if (!controller.signal.aborted) setLoaded({ filter, offset, result });
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [token, filter, offset, attempt]);
  const refresh = () => setAttempt((value) => value + 1);
  return (
    <View style={{ gap: 16 }}>
      <label style={{ fontFamily: candidateText.body.fontFamily, fontSize: 16 }}>
        Requests{' '}
        <select
          aria-label="Requests"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as 'pending' | 'all');
            setOffset(0);
          }}
          style={{
            minHeight: 44,
            fontFamily: candidateText.body.fontFamily,
            fontSize: 16,
            marginLeft: 12,
          }}
        >
          <option value="pending">Pending</option>
          <option value="all">All</option>
        </select>
      </label>
      <CandidateButton label="Refresh queue" kind="outline" busy={busy} onPress={refresh} />
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={candidateText.body}>
          {loaded
            ? `Updating requests. Showing previous ${loaded.filter} requests, page ${loaded.offset / 25 + 1}`
            : 'Loading requests…'}
        </Text>
      ) : null}
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>Candidate requests are unavailable</Text>
          <CandidateButton label="Try again" kind="outline" onPress={refresh} />
        </CandidateNotice>
      ) : null}
      <View aria-busy={busy} style={{ minHeight: 200 }}>
        {loaded?.result.claims.map((claim) => (
          <ReviewRow
            key={`${claim.id}:${claim.version}:${attempt}`}
            claim={claim}
            token={token}
            accountId={loaded.result.account_id}
            disabled={busy || failed}
            onDone={refresh}
          />
        ))}
        {loaded && !loaded.result.claims.length ? (
          <Text style={candidateText.body}>No requests in this queue</Text>
        ) : null}
      </View>
      {loaded ? (
        <View style={candidateAccountStyles.actions}>
          <CandidateButton
            label="Previous requests"
            kind="outline"
            disabled={busy || failed || loaded.offset === 0}
            onPress={() => setOffset(Math.max(0, loaded.offset - 25))}
          />
          <Text style={candidateText.body}>Page {loaded.offset / 25 + 1}</Text>
          <CandidateButton
            label="Next requests"
            kind="outline"
            disabled={busy || failed || !loaded.result.has_more}
            onPress={() => setOffset(loaded.offset + 25)}
          />
        </View>
      ) : null}
    </View>
  );
}
function ReportsQueue({ token }: { token: string }) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<CandidateStatementReports | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
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
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [token, offset, attempt]);
  const resolve = async (id: string) => {
    const scope = lifetime.current;
    if (!scope || !loaded || saving || busy) return;
    setSaving(id);
    try {
      await resolveCandidateStatementReport(token, id, loaded.account_id, scope.signal);
      if (!scope.signal.aborted) setAttempt((value) => value + 1);
    } catch {
      if (!scope.signal.aborted) setFailed(true);
    } finally {
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
            <CandidateButton
              label="Mark report reviewed"
              kind="outline"
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
function PrivateQueues({ token }: { token: string }) {
  return (
    <View style={{ gap: 40 }}>
      <ClaimsQueue token={token} />
      <ReportsQueue token={token} />
    </View>
  );
}
export function AdminCandidateClaimsScreen({
  navigation,
}: RootScreenProps<'AdminCandidateClaims'>) {
  const { user, accessToken } = useAuth();
  const admin = useAdminAccess();
  const { openSignIn } = useSignInModal();
  const { isMobile, isDesktop } = useResponsive();
  useDocumentTitle('/admin/candidate-claims', 'Candidate requests | Alethical');
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
          <View style={{ maxWidth: 900, width: '100%', alignSelf: 'center', gap: 22 }}>
            <CandidateLink
              internal
              label="Back to candidates"
              url="/candidates"
              onPress={() => navigation.navigate('Candidates')}
            />
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                { fontSize: isMobile ? 32 : 44, lineHeight: isMobile ? 39 : 51 },
              ]}
            >
              Candidate requests
            </Text>
            {admin.state === 'allowed' && user && accessToken ? (
              <PrivateQueues key={user.id} token={accessToken} />
            ) : admin.state === 'signed-out' ? (
              <>
                <Text style={candidateText.body}>
                  Sign in with an administrator account to review candidate requests
                </Text>
                <CandidateButton
                  label="Sign in"
                  icon="none"
                  onPress={() => openSignIn({ intent: 'nav', returnTo: '/admin/candidate-claims' })}
                />
              </>
            ) : admin.state === 'loading' ? (
              <Text style={candidateText.body}>Checking access…</Text>
            ) : admin.state === 'error' ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>We couldn’t check access</Text>
                <CandidateButton label="Try again" kind="outline" onPress={admin.retry} />
              </CandidateNotice>
            ) : (
              <Text style={candidateText.body}>
                Restricted access. This account cannot review candidate requests.
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
