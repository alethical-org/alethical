import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  getCandidateStatement,
  getMyCandidateClaims,
  reportCandidateStatement,
  type CandidateClaim,
  type CandidateStatement,
} from '../../data/candidateClaims';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useResponsive } from '../../hooks/useResponsive';
import { useAuth } from '../../providers/AuthProvider';
import { CandidateDialog, CandidateField } from './CandidateAccountControls';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
} from './CandidateControls';
import type { CandidateProfileRecord } from './types';

export function CandidateCampaignStatement({
  record,
  statement,
}: {
  record: CandidateProfileRecord;
  statement: CandidateStatement;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.statement, { padding: isMobile ? 20 : 24 }]}>
      <View style={styles.headingRow}>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[candidateText.title, { fontSize: 22, lineHeight: 30 }]}
        >
          From the campaign
        </Text>
        <Text style={styles.attribution}>Written by the campaign, not Alethical</Text>
      </View>
      <View style={{ marginTop: 16, gap: 3 }}>
        <Text style={candidateText.strong}>{record.candidate.name} · Campaign</Text>
        <Text style={[candidateText.body, { fontSize: 14.5 }]}>
          {candidateDate(statement.updated_at.slice(0, 10))}
        </Text>
      </View>
      <View style={{ marginTop: 12, gap: 2 }}>
        <Text style={[candidateText.strong, { fontSize: 14.5 }]}>Campaign access verified</Text>
        <Text style={[candidateText.body, { fontSize: 14 }]}>
          Alethical confirmed this account’s authority to manage campaign content
        </Text>
      </View>
      <View style={styles.quote}>
        <Text style={[candidateText.body, { color: '#2c322c', lineHeight: 27 }]}>
          {statement.body}
        </Text>
      </View>
    </View>
  );
}
function ReportStatement({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const scope = useRef<AbortController | null>(null);
  useEffect(() => () => scope.current?.abort(), []);
  const close = () => {
    scope.current?.abort();
    setOpen(false);
  };
  const submit = async () => {
    if (!reason.trim() || status === 'busy') return;
    const controller = new AbortController();
    scope.current = controller;
    setStatus('busy');
    try {
      const response = await reportCandidateStatement(id, reason.trim(), controller.signal);
      if (!controller.signal.aborted) setStatus(response.received ? 'success' : 'error');
    } catch {
      if (!controller.signal.aborted) setStatus('error');
    }
  };
  return (
    <>
      <CandidateButton
        kind="text"
        label="Report this statement"
        onPress={() => {
          setOpen(true);
          setStatus('idle');
        }}
      />
      {open ? (
        <CandidateDialog
          title={status === 'success' ? 'Report received' : 'Report this statement'}
          onClose={close}
          initialFocus="field"
        >
          <CandidateButton kind="text" label="Close" onPress={close} />
          {status === 'success' ? (
            <Text accessibilityLiveRegion="polite" style={candidateText.strong}>
              Report received
            </Text>
          ) : (
            <>
              <CandidateField
                label="Reason"
                value={reason}
                onChange={setReason}
                multiline
                readOnly={status === 'busy'}
              />
              {status === 'error' ? (
                <Text role="alert" style={candidateText.strong}>
                  We couldn’t submit your report
                </Text>
              ) : null}
              <CandidateButton
                label={status === 'error' ? 'Try again' : 'Submit report'}
                icon="none"
                busy={status === 'busy'}
                disabled={!reason.trim()}
                onPress={() => void submit()}
                style={{ minWidth: 200 }}
              />
            </>
          )}
        </CandidateDialog>
      ) : null}
    </>
  );
}
function ProfileAccountAction({
  record,
  token,
  onClaim,
  onManage,
}: {
  record: CandidateProfileRecord;
  token: string;
  onClaim(): void;
  onManage(): void;
}) {
  const [claim, setClaim] = useState<CandidateClaim | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void getMyCandidateClaims(token, record.candidate.id, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) {
          setClaim(
            response.claims.find((item) => item.candidate_id === record.candidate.id) ?? null,
          );
          setStatus('ready');
        }
      },
      () => {
        if (!controller.signal.aborted) setStatus('error');
      },
    );
    return () => controller.abort();
  }, [token, record.candidate.id, attempt]);
  if (status === 'loading')
    return (
      <Text accessibilityLiveRegion="polite" style={candidateText.body}>
        Loading profile access…
      </Text>
    );
  if (status === 'error')
    return (
      <CandidateNotice error>
        <Text style={candidateText.strong}>Profile access is unavailable</Text>
        <CandidateButton
          kind="outline"
          label="Try again"
          onPress={() => setAttempt((value) => value + 1)}
        />
      </CandidateNotice>
    );
  return (
    <CandidateLink
      internal
      url={`/candidates/${record.candidate.id}/${claim?.status === 'approved' ? 'manage' : 'claim'}`}
      label={
        claim?.status === 'approved'
          ? 'Manage this profile'
          : claim?.status === 'pending'
            ? 'View claim status'
            : 'Claim this profile'
      }
      onPress={claim?.status === 'approved' ? onManage : onClaim}
    />
  );
}
export function CandidateClaimPanel({
  record,
  onClaim,
  onManage,
  onAdmin,
}: {
  record: CandidateProfileRecord;
  onClaim(): void;
  onManage(): void;
  onAdmin(): void;
}) {
  const { isLoading, isSignedIn, user, accessToken } = useAuth();
  const focused = useIsFocused();
  const admin = useAdminAccess();
  const [loaded, setLoaded] = useState<{ id: string; statement: CandidateStatement | null } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    setFailed(false);
    void getCandidateStatement(record.candidate.id, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted)
          setLoaded({ id: record.candidate.id, statement: response.statement });
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [record.candidate.id, attempt, focused]);
  const statement = loaded?.id === record.candidate.id ? loaded.statement : null;
  return (
    <>
      {statement?.body ? (
        <>
          <CandidateCampaignStatement record={record} statement={statement} />
          <View style={{ alignItems: 'flex-end' }}>
            <ReportStatement id={record.candidate.id} />
          </View>
        </>
      ) : null}
      {failed ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>Campaign statement is unavailable</Text>
          <CandidateButton
            kind="outline"
            label="Try again"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </CandidateNotice>
      ) : null}
      <View style={styles.action}>
        {isLoading ? (
          <Text style={candidateText.body}>Loading profile access…</Text>
        ) : isSignedIn && user && accessToken ? (
          <ProfileAccountAction
            key={`${user.id}:${accessToken}:${record.candidate.id}:${focused}`}
            record={record}
            token={accessToken}
            onClaim={onClaim}
            onManage={onManage}
          />
        ) : (
          <CandidateLink
            internal
            url={`/candidates/${record.candidate.id}/claim`}
            label="Claim this profile"
            onPress={onClaim}
          />
        )}
        {admin.state === 'allowed' ? (
          <CandidateLink
            internal
            url="/admin/candidate-claims"
            label="Review candidate requests"
            onPress={onAdmin}
          />
        ) : null}
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  statement: {
    marginTop: 36,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  attribution: {
    ...candidateText.strong,
    fontSize: 13.5,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  quote: {
    marginTop: 18,
    padding: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 12,
  },
  action: {
    marginTop: 32,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.1)',
    gap: 10,
  },
});
