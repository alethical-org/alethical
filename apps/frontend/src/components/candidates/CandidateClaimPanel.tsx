import { useIsFocused } from '@react-navigation/native';
import { useEffect, useId, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  getCandidateStatement,
  getMyCandidateClaims,
  reportCandidateStatement,
  type CandidateClaimList,
  type CandidateStatement,
} from '../../data/candidateClaims';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useResponsive } from '../../hooks/useResponsive';
import { useAuth } from '../../providers/AuthProvider';
import { claimAccountBlock, profileClaimCopy, statementDateLine } from './profileClaimCopy';
import { CandidateReportDialog } from './CandidateReportDialog';
import { CandidateButton, candidateText } from './CandidateControls';
import { ProfileClaimButton } from './ProfileClaimButton';
import type { CandidateProfileRecord } from './types';

/** Statement card spacing per band, as Design settled it for the public card and the manage
 * preview: content area and white text box, each top / sides / bottom. The disclosure footer
 * keeps 10px top and bottom with the content's side padding. */
const STATEMENT_SPACING = {
  computer: { top: 26, side: 28, bottom: 24, quote: [20, 22, 20], body: 17, heading: 21 },
  tablet: { top: 24, side: 24, bottom: 22, quote: [18, 20, 18], body: 17, heading: 20 },
  phone: { top: 20, side: 18, bottom: 18, quote: [16, 16, 16], body: 16, heading: 19 },
} as const;

/** The campaign's own words first; one quiet line keeps what was checked and what was not. */
export function CandidateCampaignStatement({
  statement,
  onReport,
  preview = false,
}: {
  record: CandidateProfileRecord;
  statement: Omit<CandidateStatement, 'updated_at'> & { updated_at: string | null };
  onReport?(): void;
  preview?: boolean;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const band = STATEMENT_SPACING[isMobile ? 'phone' : isDesktop ? 'computer' : 'tablet'];
  const [width, setWidth] = useState(0);
  const dateLine = statementDateLine(statement);
  const narrow = width > 0 && width < 600;
  return (
    <View
      role={preview ? undefined : 'region'}
      aria-labelledby={preview ? undefined : 'campaign-statement-heading'}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.statement, preview && { marginTop: 0 }]}
    >
      <View
        style={{ paddingTop: band.top, paddingHorizontal: band.side, paddingBottom: band.bottom }}
      >
        <View style={styles.headingRow}>
          <Text
            nativeID={preview ? undefined : 'campaign-statement-heading'}
            accessibilityRole={preview ? undefined : 'header'}
            aria-level={preview ? undefined : 2}
            style={[
              candidateText.title,
              {
                fontSize: band.heading,
                lineHeight: band.heading * 1.3,
                letterSpacing: band.heading * -0.01,
              },
            ]}
          >
            Campaign statement
          </Text>
          {dateLine ? (
            <Text
              style={[
                candidateText.body,
                {
                  fontSize: 14.5,
                  lineHeight: 21,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {dateLine}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.quote,
            {
              paddingTop: band.quote[0],
              paddingHorizontal: band.quote[1],
              paddingBottom: band.quote[2],
            },
          ]}
        >
          <Text
            style={[
              candidateText.body,
              { color: '#2c322c', fontSize: band.body, lineHeight: band.body * 1.65 },
              Platform.OS === 'web'
                ? ({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as TextStyle)
                : null,
            ]}
          >
            {statement.body}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.statementFooter,
          { paddingHorizontal: band.side },
          narrow && { flexDirection: 'column', alignItems: 'flex-start', rowGap: 4 },
        ]}
      >
        <Text
          style={[
            candidateText.body,
            { paddingVertical: 8, fontSize: 15, lineHeight: 22.5, minWidth: 0 },
            narrow ? null : { flexGrow: 1, flexShrink: 1, flexBasis: 280 },
            Platform.OS === 'web' ? ({ textWrap: 'pretty' } as TextStyle) : null,
          ]}
        >
          {profileClaimCopy.disclosure}
        </Text>
        {onReport ? (
          <CandidateButton
            kind="text"
            icon="none"
            label="Report this statement"
            onPress={onReport}
            fontSize={15}
            style={{ minHeight: 44, paddingHorizontal: 0 }}
          />
        ) : null}
      </View>
    </View>
  );
}
function AccessLoading() {
  return (
    <View role="status" style={styles.accessRow}>
      <ActivityIndicator size="small" color="#4f5651" />
      <Text style={[candidateText.strong, { fontSize: 15.5, color: '#4f5651' }]}>
        Loading profile claim status…
      </Text>
    </View>
  );
}
function ClosedNotice() {
  return (
    <View style={{ maxWidth: 600 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Rect x={5} y={10.5} width={14} height={10} rx={2.2} stroke="#4f5651" strokeWidth={2} />
          <Path d="M8 10.5 V8 a4 4 0 0 1 8 0 V10.5" stroke="#4f5651" strokeWidth={2} />
        </Svg>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[
            candidateText.strong,
            { flex: 1, fontSize: 17, lineHeight: 22.95, fontWeight: '800' },
          ]}
        >
          {profileClaimCopy.closedTitle}
        </Text>
      </View>
      <Text
        style={[
          candidateText.body,
          { marginTop: 6, marginLeft: 28, fontSize: 15, lineHeight: 22.5 },
          Platform.OS === 'web' ? ({ textWrap: 'pretty' } as TextStyle) : null,
        ]}
      >
        {profileClaimCopy.closed}
      </Text>
    </View>
  );
}
function AccountAction({
  record,
  status,
  isAdmin = false,
  canManage,
  onClaim,
  onManage,
  onAdmin,
}: {
  record: CandidateProfileRecord;
  status?: string;
  isAdmin?: boolean;
  canManage?: boolean;
  onClaim(): void;
  onManage(): void;
  onAdmin(): void;
}) {
  const { isMobile } = useResponsive();
  const description = useId();
  const closed = record.electionEnded === true;
  const owner = status === 'approved' && canManage !== false;
  const saved = ['approved', 'pending', 'rejected', 'withdrawn', 'revoked'].includes(status ?? '');
  const label = isAdmin
    ? 'Review profile claim requests'
    : owner
      ? 'Manage this profile'
      : saved
        ? 'View profile claim status'
        : profileClaimCopy.claimLabel;
  const explanation = isAdmin
    ? profileClaimCopy.admin
    : owner
      ? profileClaimCopy.manage
      : status === 'pending'
        ? closed
          ? profileClaimCopy.endedAction
          : profileClaimCopy.pendingAction
        : status === 'rejected'
          ? profileClaimCopy.rejectedAction
          : status === 'withdrawn'
            ? profileClaimCopy.withdrawnAction
            : status === 'revoked'
              ? profileClaimCopy.revokedAction
              : profileClaimCopy.claim;
  // An account's own saved state always comes before the closed-election notice.
  if (!isAdmin && !owner && !saved && closed) return <ClosedNotice />;
  return (
    <View style={{ gap: 8, maxWidth: 600, width: '100%', alignItems: 'flex-start' }}>
      <View style={{ width: isMobile ? '100%' : undefined }}>
        <CandidateButton
          href={
            isAdmin
              ? `/admin/candidate-claims?candidate=${encodeURIComponent(record.candidate.id)}&from=profile`
              : `/candidates/${record.candidate.id}/${owner ? 'manage' : 'claim'}`
          }
          kind={!isAdmin && (owner || !saved) ? 'green' : 'black'}
          icon="none"
          label={label}
          describedBy={description}
          onPress={isAdmin ? onAdmin : owner ? onManage : onClaim}
          textStyle={{ lineHeight: 20.8 }}
          style={{ minHeight: 48, paddingVertical: 11, width: isMobile ? '100%' : undefined }}
        />
      </View>
      <Text nativeID={description} style={[candidateText.body, { fontSize: 15 }]}>
        {explanation}
      </Text>
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
  onAdmin,
}: {
  record: CandidateProfileRecord;
  token: string;
  getClaims: typeof getMyCandidateClaims;
  onClaim(): void;
  onManage(): void;
  onAdmin(): void;
}) {
  const [response, setResponse] = useState<CandidateClaimList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setResponse(null);
    void getClaims(token, record.candidate.id, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setResponse(result);
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
        <Text style={[candidateText.strong, { fontSize: 15.5 }]}>{profileClaimCopy.failed}</Text>
        <CandidateButton
          kind="outline"
          icon="none"
          label="Try again"
          onPress={() => setAttempt((value) => value + 1)}
          style={{ minHeight: 44 }}
        />
      </View>
    );
  const claim = response?.claims.find((item) => item.candidate_id === record.candidate.id);
  if (!claim && response?.request_eligibility?.reason === 'official_record_unavailable')
    return (
      <Text style={candidateText.body}>{claimAccountBlock('official_record_unavailable')}</Text>
    );
  return (
    <AccountAction
      record={{ ...record, electionEnded: claim?.election_ended ?? record.electionEnded }}
      status={claim?.status}
      isAdmin={response?.is_admin}
      canManage={claim?.can_manage}
      onClaim={onClaim}
      onManage={onManage}
      onAdmin={onAdmin}
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
  const [retrying, setRetrying] = useState(false);
  const [reporting, setReporting] = useState<{ id: string; statement: CandidateStatement } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    // A retry keeps the failure box and its button in place until the answer arrives.
    void services.getStatement(record.candidate.id, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        setLoaded({ id: record.candidate.id, statement: response.statement });
        setFailed(false);
        setRetrying(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setFailed(true);
        setRetrying(false);
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
          <Text
            style={[
              candidateText.strong,
              { flexShrink: 1, fontSize: 16.5, lineHeight: 23.925, fontWeight: '800' },
              Platform.OS === 'web' ? ({ textWrap: 'pretty' } as TextStyle) : null,
            ]}
          >
            We couldn’t load the campaign statement
          </Text>
          <ProfileClaimButton
            label="Try again"
            busyLabel="Trying again…"
            busy={retrying}
            announcement="Loading the campaign statement…"
            style={{ minHeight: 44, borderRadius: 11, fontSize: 15.5, padding: '10px 20px' }}
            onPress={() => {
              setRetrying(true);
              setAttempt((value) => value + 1);
            }}
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
              <Text style={candidateText.strong}>We couldn’t load your profile claim status</Text>
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
              record={record}
              status={previewAccount}
              onAdmin={onAdmin}
              onClaim={onClaim}
              onManage={onManage}
            />
          )
        ) : isLoading ? (
          <AccessLoading />
        ) : admin.state === 'allowed' ? (
          <AccountAction
            record={record}
            isAdmin
            onClaim={onClaim}
            onManage={onManage}
            onAdmin={onAdmin}
          />
        ) : isSignedIn && user && accessToken ? (
          <ProfileAccountAction
            key={`${user.id}:${accessToken}:${record.candidate.id}:${focused}`}
            record={record}
            token={accessToken}
            getClaims={services.getClaims}
            onAdmin={onAdmin}
            onClaim={onClaim}
            onManage={onManage}
          />
        ) : (
          <AccountAction record={record} onClaim={onClaim} onManage={onManage} onAdmin={onAdmin} />
        )}
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
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 4,
  },
  quote: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 12,
  },
  statementFooter: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 20,
    rowGap: 4,
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
    columnGap: 18,
    rowGap: 10,
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
