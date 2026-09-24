import { useId } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCommitteeNotices } from '../../hooks/useCommitteeNotices';
import { useResponsive } from '../../hooks/useResponsive';
import {
  contributionTab,
  MONEY_DETAILS_TABS,
  paymentGroupKey,
} from '../../lib/campaignMoneyDetails';
import { moneyDetailsCopy } from '../../lib/campaignMoneyDetailsCopy';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { AMENDED_CHIP } from '../../lib/committeeMoney';
import {
  minnesotaToday,
  noticeFirstFiledLine,
  noticeMatchedAccessibleName,
  noticePdfAccessibleName,
  noticesCardDraws,
  noticesCopiedLine,
  noticesLead,
  noticeStatusText,
  noticeWindowDates,
  NOTICE_AMENDED_NOTE,
  NOTICE_LOAN_CHIP,
  NOTICE_PDF_LABEL,
  NOTICE_RECEIVED_LABEL,
  NOTICE_WINDOW_NONE,
  NOTICE_WINDOW_NOT_OPEN,
  NOTICE_WINDOW_OPEN,
  NOTICES_FAILED,
  NOTICES_HEADING,
  NOTICES_LOADING,
  NOTICES_SOURCE_LABEL,
  windowOpenState,
  type CommitteeNotice,
  type NoticeThreshold,
  type NoticeWindow,
} from '../../lib/committeeNotices';
import { formatDay, formatMoney } from '../../lib/moneyFormat';
import { requestPaymentFocus } from '../../lib/paymentFocusRequest';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { LinkArrowLabel } from '../LinkArrow';
import { Skeleton } from '../Skeleton';
import { BoardPdfLink, OutwardArrow } from './DisclosureStatementPanel';

const band = {
  computer: { pad: { paddingTop: 30, paddingHorizontal: 32, paddingBottom: 28 }, h: 24, body: 17 },
  tablet: { pad: { paddingTop: 26, paddingHorizontal: 26, paddingBottom: 24 }, h: 22, body: 16 },
  phone: { pad: { paddingVertical: 20, paddingHorizontal: 18 }, h: 20, body: 15 },
};

/** The tab a matched payment sits under in the payment list above. */
function matchedTabLabel(notice: CommitteeNotice): string | null {
  const payment = notice.matchedPayment;
  if (!payment) return null;
  const tab = contributionTab(payment.contributorType);
  return MONEY_DETAILS_TABS.find((item) => item.id === tab)?.label ?? null;
}

/**
 * Large-contribution notices, directly after the payment list (#2347, build-facts §2).
 *
 * Absent by scope where no notice window applies: a party unit, a year no copy of the
 * Board's list covers, a filer every window is ruled out for. Never drawn empty. No
 * notice amount is added to anything; a matched notice and its payment row are one
 * gift, drawn twice on purpose.
 */
export function CommitteeNoticesCard({
  registrationNumber,
  year,
  thresholdHint = null,
  today = minnesotaToday(),
}: {
  registrationNumber: string;
  year: number;
  /** The lead's threshold before the answer arrives, where the filer kind settles it. */
  thresholdHint?: NoticeThreshold | null;
  today?: string;
}) {
  const query = useCommitteeNotices(registrationNumber, year);
  const { isMobile, isTablet } = useResponsive();
  const size = isMobile ? band.phone : isTablet ? band.tablet : band.computer;
  const headingId = useId();
  if (query.isSuccess && !noticesCardDraws(query.data)) return null;
  // The Board's list carries the current election year only, so a loading or failed
  // card for any other year would be drawn only to vanish or to report on a list that
  // never covered it.
  if (!query.isSuccess && year !== Number(today.slice(0, 4))) return null;
  const threshold = query.data?.threshold ?? thresholdHint;
  const lead = threshold ? noticesLead(threshold) : null;
  return (
    <View
      role="region"
      aria-labelledby={headingId}
      testID="committee-notices"
      style={[styles.card, size.pad]}
    >
      <Text
        nativeID={headingId}
        accessibilityRole="header"
        aria-level={2}
        style={[styles.heading, { fontSize: size.h }]}
      >
        {NOTICES_HEADING}
      </Text>
      {lead ? <Text style={[styles.lead, { fontSize: size.body }]}>{lead}</Text> : null}
      {query.isPending ? (
        <View role="status" aria-busy style={styles.stateBlock}>
          <Text style={[styles.lead, { fontSize: size.body }]}>{NOTICES_LOADING}</Text>
          <View style={styles.skeletons}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.skeletonRow}>
                <Skeleton width="40%" height={14} />
                <Skeleton width="60%" height={11} />
              </View>
            ))}
          </View>
        </View>
      ) : query.isError ? (
        <View role="alert" style={styles.stateBlock}>
          <Text style={[styles.lead, { fontSize: size.body }]}>{NOTICES_FAILED}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void query.refetch()}
            style={(state) => [
              styles.retry,
              Boolean('focused' in state && state.focused) && styles.focus,
            ]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : query.data ? (
        <>
          <View style={styles.windows}>
            {query.data.windows.map((window) => (
              <WindowGroup
                key={window.key}
                window={window}
                today={today}
                body={size.body}
                isMobile={isMobile}
                coveredThrough={query.data!.reportCoveredThrough}
              />
            ))}
          </View>
          {query.data.anyAmended ? <Text style={styles.note}>{NOTICE_AMENDED_NOTE}</Text> : null}
          <View style={styles.foot}>
            <Text style={styles.footText}>
              <Text
                {...externalLinkProps(
                  query.data.sourceUrl,
                  () => void Linking.openURL(query.data!.sourceUrl),
                )}
                style={styles.sourceLink}
              >
                {NOTICES_SOURCE_LABEL}
                <Text style={styles.inlineArrow}>
                  <OutwardArrow />
                </Text>
              </Text>
              {noticesCopiedLine(query.data.copiedOn).slice(NOTICES_SOURCE_LABEL.length)}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function WindowGroup({
  window,
  today,
  body,
  isMobile,
  coveredThrough,
}: {
  window: NoticeWindow;
  today: string;
  body: number;
  isMobile: boolean;
  coveredThrough: string | null;
}) {
  const labelId = useId();
  const datesId = useId();
  const state = windowOpenState(window, today);
  const chip =
    state === 'open' ? NOTICE_WINDOW_OPEN : state === 'not_open' ? NOTICE_WINDOW_NOT_OPEN : null;
  return (
    <View role="group" aria-labelledby={`${labelId} ${datesId}`}>
      <View style={[styles.windowHead, isMobile && styles.windowHeadMobile]}>
        <Text
          nativeID={labelId}
          accessibilityRole="header"
          aria-level={3}
          style={[styles.windowLabel, { fontSize: body }]}
        >
          {window.label}
        </Text>
        <Text nativeID={datesId} style={styles.windowDates}>
          {noticeWindowDates(window)}
        </Text>
        {chip ? <Text style={styles.chip}>{chip}</Text> : null}
      </View>
      {state === 'not_open' ? null : window.notices.length === 0 ? (
        <Text style={[styles.empty, { fontSize: Math.min(body, 16) }]}>{NOTICE_WINDOW_NONE}</Text>
      ) : (
        <View role="list">
          {window.notices.map((notice, index) => (
            <NoticeRow
              key={notice.id}
              notice={notice}
              body={body}
              isMobile={isMobile}
              coveredThrough={coveredThrough}
              last={index === window.notices.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function NoticeRow({
  notice,
  body,
  isMobile,
  last,
  coveredThrough,
}: {
  notice: CommitteeNotice;
  body: number;
  isMobile: boolean;
  last: boolean;
  coveredThrough: string | null;
}) {
  const tabLabel = matchedTabLabel(notice);
  const firstFiled = notice.amended ? noticeFirstFiledLine(notice) : null;
  const payment = notice.matchedPayment;
  const status = noticeStatusText(notice, tabLabel, coveredThrough);
  const pdf = (
    <BoardPdfLink
      url={notice.pdfUrl}
      label={NOTICE_PDF_LABEL}
      accessibleName={noticePdfAccessibleName(notice)}
    />
  );
  return (
    <View role="listitem" style={[styles.row, !last && styles.rowRule]}>
      <View style={[styles.rowHead, isMobile && styles.rowHeadMobile]}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, { fontSize: body }]}>{notice.contributor}</Text>
          {notice.amended ? <Text style={styles.amended}>{AMENDED_CHIP}</Text> : null}
        </View>
        <Text style={[styles.amount, { fontSize: body }]}>{formatMoney(notice.amount)}</Text>
      </View>
      <Text style={styles.details}>
        <Text style={styles.date}>{formatDay(notice.contributionDate)}</Text>
        {notice.receivedOn ? (
          <>
            <Text aria-hidden style={styles.dot}>
              {' · '}
            </Text>
            <Text style={styles.nowrap}>
              {NOTICE_RECEIVED_LABEL} {formatDay(notice.receivedOn)}
            </Text>
          </>
        ) : null}
        {notice.employer ? (
          <>
            <Text aria-hidden style={styles.dot}>
              {' · '}
            </Text>
            {notice.employer}
          </>
        ) : null}
        {notice.inKind ? (
          <>
            <Text aria-hidden style={styles.dot}>
              {' · '}
            </Text>
            <Text style={styles.marker}>{moneyDetailsCopy.inKindMarker}</Text>
            {notice.inKindDescription ? ` ${notice.inKindDescription}` : null}
          </>
        ) : null}
        {notice.loan ? (
          <>
            <Text aria-hidden style={styles.dot}>
              {' · '}
            </Text>
            <Text style={styles.marker}>{NOTICE_LOAN_CHIP}</Text>
          </>
        ) : null}
      </Text>
      {firstFiled ? <Text style={styles.firstFiled}>{firstFiled}</Text> : null}
      <View style={[styles.statusRow, isMobile && styles.statusRowStacked]}>
        {notice.status === 'matched' && payment ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={noticeMatchedAccessibleName(notice)}
            onPress={() =>
              requestPaymentFocus({
                tab: contributionTab(payment.contributorType),
                groupKey: paymentGroupKey(
                  contributionTab(payment.contributorType),
                  payment.contributor === '' ? null : payment.contributor,
                ),
                recordNumber: payment.recordNumber,
              })
            }
            style={(state) => [
              styles.matched,
              Boolean('focused' in state && state.focused) && styles.focus,
            ]}
          >
            <LinkArrowLabel label={status} style={styles.matchedText} />
          </Pressable>
        ) : (
          <Text style={[styles.statusText, notice.status !== 'matched' && styles.statusBlock]}>
            {status}
          </Text>
        )}
        {pdf}
      </View>
    </View>
  );
}

const small = 15;
const styles = StyleSheet.create({
  card: {
    marginTop: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 16,
    ...({ boxShadow: '0 8px 24px rgba(17,21,15,0.05)' } as object),
  },
  heading: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.24,
    lineHeight: 29,
    color: c.text,
  },
  lead: {
    marginTop: 10,
    maxWidth: 900,
    fontFamily: t.typography.body,
    lineHeight: 25,
    color: c.secondary,
  },
  stateBlock: { marginTop: 12, gap: 14, alignItems: 'flex-start' },
  skeletons: {
    alignSelf: 'stretch',
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
  },
  skeletonRow: {
    paddingVertical: 16,
    paddingHorizontal: 2,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  retry: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: c.text,
    justifyContent: 'center',
    ...({ outlineStyle: 'none' } as object),
  },
  retryText: {
    fontFamily: t.typography.body,
    fontSize: small,
    fontWeight: '800',
    color: '#ffffff',
  },
  focus: { outlineColor: c.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
  windows: { marginTop: 24, gap: 28 },
  windowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.14)',
  },
  windowHeadMobile: { flexDirection: 'column', alignItems: 'flex-start' },
  windowLabel: { fontFamily: t.typography.body, fontWeight: '800', color: c.text },
  windowDates: {
    fontFamily: t.typography.body,
    fontSize: small,
    fontWeight: '800',
    letterSpacing: 0.15,
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  chip: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.48,
    color: '#4f5651',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  empty: {
    marginTop: 12,
    maxWidth: 900,
    fontFamily: t.typography.body,
    lineHeight: 23,
    color: c.secondary,
  },
  row: { paddingVertical: 14, paddingHorizontal: 2, gap: 6 },
  rowRule: { borderBottomWidth: 1, borderBottomColor: 'rgba(17,21,15,0.08)' },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 24,
    rowGap: 4,
  },
  rowHeadMobile: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 2 },
  nameLine: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 4,
  },
  name: { fontFamily: t.typography.body, fontWeight: '700', lineHeight: 23, color: c.text },
  amended: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.48,
    color: '#4f5651',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  amount: {
    flexShrink: 0,
    fontFamily: t.typography.body,
    fontWeight: '700',
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  details: {
    fontFamily: t.typography.body,
    fontSize: small,
    lineHeight: 24,
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  date: { fontWeight: '800', color: c.text, ...({ whiteSpace: 'nowrap' } as object) },
  dot: { paddingHorizontal: 4 },
  nowrap: { ...({ whiteSpace: 'nowrap' } as object) },
  marker: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0.48,
    color: '#4f5651',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 7,
    paddingHorizontal: 7,
  },
  firstFiled: {
    fontFamily: t.typography.body,
    fontSize: small,
    fontWeight: '700',
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 18,
    rowGap: 8,
  },
  statusRowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  matched: {
    minHeight: 44,
    flexShrink: 1,
    justifyContent: 'center',
    borderRadius: 6,
    ...({ outlineStyle: 'none' } as object),
  },
  matchedText: {
    fontFamily: t.typography.body,
    fontSize: small,
    fontWeight: '700',
    color: c.link,
  },
  statusText: {
    fontFamily: t.typography.body,
    fontSize: small,
    lineHeight: 22,
    color: c.secondary,
  },
  statusBlock: { flex: 1, minWidth: 0, maxWidth: 760 },
  note: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: small,
    lineHeight: 22.5,
    color: c.muted,
  },
  foot: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
  },
  footText: {
    fontFamily: t.typography.body,
    fontSize: small,
    lineHeight: 22.5,
    color: c.secondary,
    fontVariant: ['tabular-nums'],
  },
  sourceLink: { color: c.link, fontWeight: '700', textDecorationLine: 'underline' },
  inlineArrow: {
    marginLeft: 4,
    ...({ display: 'inline-flex', verticalAlign: 'middle' } as object),
  },
});
