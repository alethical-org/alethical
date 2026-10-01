import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
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
import { CandidateReportDialog } from './CandidateReportDialog';
import { CandidateButton, CandidateLink, candidateDate, candidateText } from './CandidateControls';
import type { CandidateProfileRecord } from './types';

export function CandidateCampaignStatement({
  statement,
  onReport,
}: {
  record: CandidateProfileRecord;
  statement: CandidateStatement;
  onReport?(): void;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.statement}>
      <View style={{ padding: isMobile ? 20 : 24 }}>
        <View style={styles.headingRow}>
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[candidateText.title, { fontSize: 22, lineHeight: 30 }]}
          >
            From the campaign
          </Text>
          <View style={styles.attribution}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
              <Path
                d="M4 5.5H20V16H10L5.5 20V16H4Z"
                stroke="#4f5651"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[candidateText.strong, { fontSize: 13.5, flexShrink: 1 }]}>
              Written by the campaign, not Alethical
            </Text>
          </View>
        </View>
        <Text style={[candidateText.body, { fontSize: 14.5, marginTop: 12 }]}>
          Published {candidateDate(statement.updated_at.slice(0, 10))}
        </Text>
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            style={{ marginTop: 1 }}
          >
            <Path
              d="M12 3L19 6V11.5C19 15.8 16 19.2 12 21C8 19.2 5 15.8 5 11.5V6Z M9 12L11.2 14.2L15.2 10"
              stroke="#4f5651"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={[candidateText.strong, { fontSize: 14.5 }]}>Campaign access verified</Text>
            <Text style={[candidateText.body, { fontSize: 14, lineHeight: 20.3 }]}>
              Alethical confirmed this account’s authority to manage campaign content
            </Text>
          </View>
        </View>
        <View style={styles.quote}>
          <Text style={[candidateText.body, { color: '#2c322c', lineHeight: 27 }]}>
            {statement.body}
          </Text>
        </View>
      </View>
      {onReport ? (
        <View style={[styles.reportFooter, { paddingHorizontal: isMobile ? 20 : 24 }]}>
          <CandidateButton
            kind="text"
            icon="none"
            label="Report this statement"
            onPress={onReport}
            style={{ minHeight: 44, paddingHorizontal: 0 }}
          />
        </View>
      ) : null}
    </View>
  );
}
function AccessLoading() {
  return (
    <View role="status" style={styles.accessRow}>
      <ActivityIndicator size="small" color="#4f5651" />
      <Text style={[candidateText.strong, { fontSize: 15.5, color: '#4f5651' }]}>
        Loading profile access…
      </Text>
    </View>
  );
}
function AccountAction({
  candidateId,
  status,
  onClaim,
  onManage,
}: {
  candidateId: string;
  status?: string;
  onClaim(): void;
  onManage(): void;
}) {
  const { isMobile } = useResponsive();
  const owner = status === 'approved';
  const pending = status === 'pending';
  return (
    <View
      style={{
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        flexWrap: 'wrap',
        columnGap: 16,
        rowGap: 10,
      }}
    >
      <CandidateButton
        href={`/candidates/${candidateId}/${owner ? 'manage' : 'claim'}`}
        kind={owner ? 'green' : 'outline'}
        icon="none"
        label={owner ? 'Manage this profile' : pending ? 'View claim status' : 'Claim this profile'}
        onPress={owner ? onManage : onClaim}
        style={{ minHeight: 48, width: isMobile ? '100%' : undefined }}
      />
      {!owner && !pending ? (
        <Text style={[candidateText.body, { fontSize: 15, flexShrink: 1 }]}>
          For candidates and authorized campaign representatives
        </Text>
      ) : null}
    </View>
  );
}
export const candidateClaimServices = {
  getStatement: getCandidateStatement,
  getClaims: getMyCandidateClaims,
  reportStatement: reportCandidateStatement,
};

function ProfileAccountAction({
  record,
  token,
  getClaims,
  onClaim,
  onManage,
}: {
  record: CandidateProfileRecord;
  token: string;
  getClaims: typeof getMyCandidateClaims;
  onClaim(): void;
  onManage(): void;
}) {
  const [claim, setClaim] = useState<CandidateClaim | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void getClaims(token, record.candidate.id, controller.signal).then(
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
  }, [token, record.candidate.id, attempt, getClaims]);
  if (status === 'loading') return <AccessLoading />;
  if (status === 'error')
    return (
      <View role="alert" style={styles.accessRow}>
        <Text style={[candidateText.strong, { fontSize: 15.5 }]}>
          Profile access is unavailable
        </Text>
        <CandidateButton
          kind="outline"
          icon="none"
          label="Try again"
          onPress={() => setAttempt((value) => value + 1)}
          style={{ minHeight: 44 }}
        />
      </View>
    );
  return (
    <AccountAction
      candidateId={record.candidate.id}
      status={claim?.status}
      onClaim={onClaim}
      onManage={onManage}
    />
  );
}
export function CandidateClaimPanel({
  record,
  onClaim,
  onManage,
  onAdmin,
  services = candidateClaimServices,
  previewAccount,
}: {
  record: CandidateProfileRecord;
  onClaim(): void;
  onManage(): void;
  onAdmin(): void;
  services?: typeof candidateClaimServices;
  previewAccount?: 'loading' | 'public' | 'approved' | 'pending' | 'error';
}) {
  const { isLoading, isSignedIn, user, accessToken } = useAuth();
  const focused = useIsFocused();
  const admin = useAdminAccess();
  const [loaded, setLoaded] = useState<{ id: string; statement: CandidateStatement | null } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [reporting, setReporting] = useState<{ id: string; statement: CandidateStatement } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    setFailed(false);
    void services.getStatement(record.candidate.id, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted)
          setLoaded({ id: record.candidate.id, statement: response.statement });
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [record.candidate.id, attempt, focused, services]);
  const statement = loaded?.id === record.candidate.id ? loaded.statement : null;
  return (
    <>
      {statement?.body ? (
        <CandidateCampaignStatement
          record={record}
          statement={statement}
          onReport={() => setReporting({ id: record.candidate.id, statement })}
        />
      ) : null}
      {failed ? (
        <View role="alert" style={styles.campaignFailure}>
          <Text style={candidateText.strong}>Campaign statement is unavailable</Text>
          <CandidateButton
            kind="outline"
            label="Try again"
            icon="none"
            style={{ minHeight: 44 }}
            onPress={() => setAttempt((value) => value + 1)}
          />
        </View>
      ) : null}
      {reporting?.id === record.candidate.id && focused ? (
        <CandidateReportDialog
          candidateId={record.candidate.id}
          report={services.reportStatement}
          statement={reporting.statement}
          onClose={() => setReporting(null)}
          onReload={async (signal) => {
            const response = await services.getStatement(record.candidate.id, signal);
            if (!signal.aborted) {
              setLoaded({ id: record.candidate.id, statement: response.statement });
              setFailed(false);
            }
            return response.statement;
          }}
        />
      ) : null}
      <View style={styles.action}>
        {previewAccount ? (
          previewAccount === 'loading' ? (
            <AccessLoading />
          ) : previewAccount === 'error' ? (
            <View role="alert" style={styles.accessRow}>
              <Text style={candidateText.strong}>Profile access is unavailable</Text>
              <CandidateButton
                kind="outline"
                icon="none"
                label="Try again"
                onPress={onClaim}
                style={{ minHeight: 44 }}
              />
            </View>
          ) : (
            <AccountAction
              candidateId={record.candidate.id}
              status={previewAccount}
              onClaim={onClaim}
              onManage={onManage}
            />
          )
        ) : isLoading ? (
          <AccessLoading />
        ) : isSignedIn && user && accessToken ? (
          <ProfileAccountAction
            key={`${user.id}:${accessToken}:${record.candidate.id}:${focused}`}
            record={record}
            token={accessToken}
            getClaims={services.getClaims}
            onClaim={onClaim}
            onManage={onManage}
          />
        ) : (
          <AccountAction candidateId={record.candidate.id} onClaim={onClaim} onManage={onManage} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
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
  campaignFailure: {
    marginTop: 36,
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  reportFooter: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    paddingTop: 6,
    paddingBottom: 12,
    alignItems: 'flex-end',
  },
  accessRow: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  action: {
    marginTop: 32,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.1)',
    gap: 10,
  },
});
