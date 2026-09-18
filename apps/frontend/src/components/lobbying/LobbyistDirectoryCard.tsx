import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { GreenLinkArrow } from '../LinkArrow';
import { useHover } from '../billDetail/interactions';
import { LobbyingDonationNotes, LobbyingDonationSelects } from './LobbyingDonationControls';
import { lobbyingDonationAmountParts } from '../../lib/lobbyingDonationDirectory';
import { LOBBYING_DIRECTORY_COPY as copy } from '../../lib/lobbyingDirectoryCopy';
import type {
  LobbyingDirectoryDonations,
  LobbyingDonationSort,
  LobbyingLobbyistListRow,
} from '../../lib/lobbyingTypes';
import { useResponsive } from '../../hooks/useResponsive';
import { linkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

export interface LobbyistDirectoryCardRow {
  id: string;
  name: string;
  meta: string | null;
  href: string;
  open: () => void;
  amount: LobbyingLobbyistListRow;
}

/**
 * One results card for `/money/lobbying/lobbyists`. The count, Year and Sort by share
 * the card header, so every question the amount column raises is answered directly
 * above the rows it governs. Loading, failure and both empty results keep that header
 * and the amounts note, because they describe the list whatever it currently holds.
 */
export function LobbyistDirectoryCard({
  countLine,
  pending,
  failed,
  rows,
  emptyPage,
  firstPageHref,
  onFirstPage,
  onRetry,
  pagination,
  donations,
  donationYear,
  sort,
  requestedYear,
  onYear,
  onSort,
}: {
  countLine: string | null;
  pending: boolean;
  failed: boolean;
  rows: LobbyistDirectoryCardRow[];
  /** True when this numbered page is empty but the whole result is not. */
  emptyPage: boolean;
  firstPageHref: string;
  onFirstPage: () => void;
  onRetry: () => void;
  pagination: ReactNode;
  donations?: LobbyingDirectoryDonations;
  donationYear?: number | null;
  sort: LobbyingDonationSort;
  requestedYear?: number;
  onYear: (year: string) => void;
  onSort: (sort: string) => void;
}) {
  const { isMobile, isTablet } = useResponsive();
  const settled = !pending && !failed;
  const rowPadding = isMobile ? 16 : isTablet ? 24 : 28;
  const blockPadding = isMobile ? 16 : isTablet ? 24 : 28;
  return (
    <View>
      <View style={styles.card}>
        <View
          style={[
            styles.header,
            { paddingHorizontal: blockPadding },
            isMobile ? styles.headerStacked : isTablet ? styles.headerTablet : null,
          ]}
        >
          {/* One polite announcement for the whole result, rather than a live
              region around every row. */}
          {countLine ? (
            <Text
              accessibilityRole="header"
              aria-level={2}
              aria-live="polite"
              aria-atomic="true"
              style={[styles.count, isMobile && styles.countMobile]}
            >
              {countLine}
            </Text>
          ) : null}
          <LobbyingDonationSelects
            donations={donations}
            sort={sort}
            requestedYear={requestedYear}
            loading={pending}
            stacked={isMobile}
            onYear={onYear}
            onSort={onSort}
          />
        </View>
        <View style={[styles.notes, { paddingHorizontal: blockPadding }]}>
          <LobbyingDonationNotes donations={donations} settled={settled} stacked={isMobile} />
        </View>
        {pending ? (
          <View aria-busy style={[styles.body, { paddingHorizontal: blockPadding }]}>
            {[0, 1, 2].map((slot) => (
              <View key={slot} aria-hidden style={styles.placeholder} />
            ))}
          </View>
        ) : failed ? (
          <View style={[styles.body, { paddingHorizontal: blockPadding }]}>
            <Text accessibilityRole="alert" style={styles.failure}>
              {copy.lobbyists.unavailable}
            </Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={[styles.body, { paddingHorizontal: blockPadding }]}>
            <Text style={[styles.emptyTitle, isMobile && styles.emptyTitleMobile]}>
              {emptyPage ? copy.emptyPage : copy.lobbyists.empty}
            </Text>
            {emptyPage ? (
              <Pressable {...linkProps(firstPageHref, onFirstPage)} style={styles.retry}>
                <Text style={styles.retryText}>{copy.firstPage}</Text>
              </Pressable>
            ) : (
              <Text style={styles.emptyWhy}>{copy.noMatchWhy}</Text>
            )}
          </View>
        ) : (
          <View role="list">
            {rows.map((row) => (
              <DirectoryRow
                key={row.id}
                row={row}
                year={donationYear}
                stacked={isMobile}
                paddingHorizontal={rowPadding}
                metaWidth={isTablet ? 140 : 150}
                amountWidth={isTablet ? 218 : 232}
              />
            ))}
          </View>
        )}
      </View>
      {pagination}
    </View>
  );
}

/** Name, client count, amount and arrow line up in their own columns above the phone band. */
function DirectoryRow({
  row,
  year,
  stacked,
  paddingHorizontal,
  metaWidth,
  amountWidth,
}: {
  row: LobbyistDirectoryCardRow;
  year?: number | null;
  stacked: boolean;
  paddingHorizontal: number;
  metaWidth: number;
  amountWidth: number;
}) {
  const [hovered, hover] = useHover();
  return (
    <View role="listitem">
      <Pressable
        {...linkProps(row.href, row.open)}
        {...hover}
        style={[
          styles.row,
          { paddingHorizontal },
          stacked && styles.rowStacked,
          hovered && styles.rowHovered,
        ]}
      >
        <View style={styles.nameCell}>
          <Text style={styles.name}>{row.name}</Text>
          {stacked ? <GreenLinkArrow /> : null}
        </View>
        {row.meta ? (
          <Text style={[styles.meta, stacked ? null : { width: metaWidth, ...styles.metaColumn }]}>
            {row.meta}
          </Text>
        ) : null}
        <Amount
          row={row.amount}
          year={year}
          style={stacked ? null : { width: amountWidth, flexShrink: 0 }}
        />
        {stacked ? null : <GreenLinkArrow />}
      </Pressable>
    </View>
  );
}

/** The figure carries the weight; its year tail stays quiet, with a real space between. */
function Amount({
  row,
  year,
  style,
}: {
  row: LobbyingLobbyistListRow;
  year?: number | null;
  style: StyleProp<TextStyle>;
}) {
  const parts = lobbyingDonationAmountParts(row, year);
  return (
    <Text style={[styles.amount, style]}>
      {parts.figure ? (
        <>
          <Text style={styles.amountFigure}>{parts.figure}</Text>
          <Text>{` ${parts.tail}`}</Text>
        </>
      ) : (
        parts.message
      )}
    </Text>
  );
}

const divider = 'rgba(17,21,15,0.08)';
const styles = StyleSheet.create({
  card: {
    marginTop: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: divider,
    borderRadius: 16,
    boxShadow: '0 6px 18px rgba(17,21,15,0.04)',
    overflow: 'hidden',
  },
  header: {
    paddingTop: 22,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  headerTablet: { flexDirection: 'column', alignItems: 'flex-start', gap: 14 },
  headerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 14, paddingTop: 16 },
  count: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '800',
    minWidth: 0,
    flexShrink: 1,
  },
  countMobile: { fontSize: 16, lineHeight: 24 },
  notes: {
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: divider,
    paddingTop: 6,
  },
  body: { paddingTop: 18, paddingBottom: 24, borderTopWidth: 1, borderTopColor: divider },
  placeholder: {
    height: 44,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: '#f1f3f1',
  },
  failure: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '700',
    maxWidth: 640,
  },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 12 },
  retryButton: {
    minHeight: 48,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    backgroundColor: '#fff',
  },
  retryText: {
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyTitle: {
    color: '#11150f',
    fontFamily: t.typography.title,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyTitleMobile: { fontSize: 20, lineHeight: 28 },
  emptyWhy: {
    marginTop: 9,
    maxWidth: 680,
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  row: {
    minHeight: 60,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: divider,
  },
  rowHovered: { backgroundColor: '#f4f7f5' },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  nameCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    minWidth: 0,
    flexShrink: 1,
  },
  meta: {
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    lineHeight: 22,
  },
  metaColumn: { flexShrink: 0, textAlign: 'right' },
  amount: {
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15.5,
    lineHeight: 23,
  },
  amountFigure: { color: '#11150f', fontSize: 16.5, fontWeight: '800' },
});
