import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CommitteeRefunds } from '../../data/types';
import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { refundCopy as copy, visibleRefundYears } from '../../lib/committeeRefunds';
import { formatDay, formatMoney } from '../../lib/moneyFormat';
import { externalLinkProps } from '../../navigation/links';
import { GreenLinkArrow, linkArrowRow } from '../LinkArrow';
import { theme as t } from '../../theme/tokens';
import { committeeCardStyles, detailsStyles, useCampaignMoneyTypography } from './detailsStyles';
import { useFinePointerHover } from './finePointerHover';

type Props = { refunds: CommitteeRefunds | undefined; registrationNumber: string };

/** All refund years for exactly the confirmed committee whose card precedes this one. */
export function CommitteeRefundCard({ refunds, registrationNumber }: Props) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const sourceHover = useFinePointerHover();
  if (!refunds) return null; // An older cached response does not establish an empty history.
  const rows = visibleRefundYears(refunds);
  const reported = rows.filter((row) => row.state === 'reported');
  // This is one note about the table, so every displayed source must support it.
  const jointNote =
    reported.length > 0 && reported.every((row) => row.jointFilingCountsAsOne === true);
  const copiedDay = formatDay(refunds.copiedOn);
  // The 2 figure columns hold a fixed width per band and the year column takes what is
  // left, so the count and the amount sit beside each other and the amounts line up down
  // the page. All 3 columns stay on a phone, as drawn: a table that stays a table is
  // easier to scan. The left padding is on the HEADING cells only, so the 2 caps lines
  // separate while every cell stays flush right and each figure keeps its own column.
  const [countColumn, amountColumn, headingGap] = isMobile
    ? [104, 96, 6]
    : isTablet
      ? [216, 158, 18]
      : [236, 168, 18];
  const titleId = `committee-${registrationNumber}-refunds-title`;
  const cell: React.CSSProperties = {
    padding: '14px 0',
    borderBottom: '1px solid rgba(17,21,15,0.08)',
    textAlign: 'right',
    verticalAlign: 'top',
    fontWeight: 700,
    lineHeight: 1.35,
  };
  const head: React.CSSProperties = {
    boxSizing: 'border-box',
    // Written long rather than as one `padding` line, because each heading cell adds its
    // own left padding and a shorthand beside a longhand is decided by order.
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 10,
    paddingLeft: 0,
    borderBottom: '1px solid rgba(17,21,15,0.16)',
    textAlign: 'right',
    verticalAlign: 'bottom',
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: 700,
    // Tighter on a phone, where the count column leaves 98px inside its border and
    // CONTRIBUTIONS needs 103px at the wider tracking, so the heading broke mid-word and
    // printed "CONTRIBUTION" over "S REFUNDED". Measured on the live page, 13 Sep 2026.
    letterSpacing: isMobile ? '0.06em' : '0.12em',
    textTransform: 'uppercase',
    color: c.secondary,
    overflowWrap: 'anywhere',
  };
  return (
    <View
      testID={`committee-${registrationNumber}-refunds`}
      style={[
        committeeCardStyles.card,
        isTablet && committeeCardStyles.tablet,
        isMobile && committeeCardStyles.mobile,
        styles.card,
      ]}
      {...{ role: 'region', 'aria-labelledby': titleId }}
    >
      <Text
        nativeID={titleId}
        accessibilityRole="header"
        aria-level={2}
        style={[styles.heading, { fontSize: type.h3 }]}
      >
        {copy.heading}
      </Text>
      <Text
        style={[
          styles.body,
          {
            fontSize: type.body,
            lineHeight: type.body * 1.55,
            marginTop: 12,
            maxWidth: 900,
            ...({ textWrap: 'pretty' } as object),
          },
        ]}
      >
        {copy.introduction}
      </Text>
      {rows.length ? (
        <table
          style={{
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            marginTop: 20,
            fontFamily: t.typography.body,
            fontSize: type.body,
            color: c.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <caption
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
            }}
          >
            {copy.caption}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...head, textAlign: 'left' }}>
                {copy.columns[0]}
              </th>
              <th scope="col" style={{ ...head, width: countColumn, paddingLeft: headingGap }}>
                {copy.columns[1]}
              </th>
              <th scope="col" style={{ ...head, width: amountColumn, paddingLeft: headingGap }}>
                {copy.columns[2]}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <React.Fragment key={row.year}>
                <tr>
                  <th
                    scope="row"
                    style={{
                      ...cell,
                      textAlign: 'left',
                      fontWeight: 800,
                      ...(row.state === 'not_published'
                        ? { borderBottom: 'none', paddingBottom: 0 }
                        : {}),
                    }}
                  >
                    {row.year}
                  </th>
                  {row.state === 'reported' ? (
                    <>
                      <td
                        style={{
                          ...cell,
                          // Lighter and smaller than the figures around it, so an absent
                          // count cannot read as a value.
                          ...(row.contributionsRefunded === null
                            ? { color: c.muted, fontWeight: 600, fontSize: type.small }
                            : {}),
                        }}
                      >
                        {row.contributionsRefunded === null
                          ? copy.countNotPublished
                          : row.contributionsRefunded.toLocaleString('en-US')}
                      </td>
                      <td style={cell}>{formatMoney(row.amountRefunded) ?? copy.unavailable}</td>
                    </>
                  ) : (
                    <td
                      colSpan={2}
                      style={{
                        ...cell,
                        color: c.secondary,
                        ...(row.state === 'not_published'
                          ? { borderBottom: 'none', paddingBottom: 0 }
                          : {}),
                      }}
                    >
                      {row.state === 'not_published' ? copy.notPublished : copy.unavailable}
                    </td>
                  )}
                </tr>
                {row.state === 'not_published' ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        ...cell,
                        paddingTop: 6,
                        textAlign: 'left',
                        fontSize: type.small,
                        fontWeight: 400,
                        lineHeight: 1.45,
                        color: c.muted,
                      }}
                    >
                      {copy.notPublishedDetail(row.year)}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <Text
          style={[
            styles.body,
            { fontSize: type.body, lineHeight: type.body * 1.55, marginTop: 20 },
          ]}
        >
          {refunds.state === 'not_matched' ? copy.notMatched : copy.unavailable}
        </Text>
      )}
      <View style={styles.notes}>
        {jointNote ? (
          <Text style={[styles.body, { fontSize: type.small, lineHeight: type.small * 1.5 }]}>
            {copy.jointFilingNote}
          </Text>
        ) : null}
        {reported.length ? (
          <Text style={[styles.body, { fontSize: type.small, lineHeight: type.small * 1.5 }]}>
            {copy.sourceMethod}
          </Text>
        ) : null}
        {/* A date, so it is a note rather than a link. As a link its words told a reader
            meeting it in a screen reader's list of links when we copied something and
            never where it went, and it was the only link on this tab with no arrow. */}
        {copiedDay ? (
          <Text style={[styles.body, { fontSize: type.small, lineHeight: type.small * 1.5 }]}>
            {copy.copiedOn(copiedDay)}
          </Text>
        ) : null}
      </View>
      {/* The link the date used to be, saying where it goes, with the arrow every other
          off-site link on this tab carries. It draws only where an address is served: a
          link pointed at a wrong-but-existing page lies about where it goes. */}
      {refunds.sourceUrl ? (
        <Pressable
          {...externalLinkProps(refunds.sourceUrl, () => void Linking.openURL(refunds.sourceUrl!))}
          onHoverIn={sourceHover.onHoverIn}
          onHoverOut={sourceHover.onHoverOut}
          style={(state) => [
            styles.sourceLink,
            Boolean('focused' in state && state.focused) && detailsStyles.focus,
          ]}
        >
          <Text
            style={[
              styles.sourceText,
              { fontSize: type.small, lineHeight: type.small * 1.5 },
              sourceHover.hovered && styles.sourceTextHover,
            ]}
          >
            {copy.summaries}
          </Text>
          <GreenLinkArrow />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 0 },
  heading: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    color: c.text,
    letterSpacing: -0.4,
  },
  body: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    color: c.secondary,
  },
  notes: { marginTop: 18, gap: 7 },
  sourceLink: {
    ...linkArrowRow,
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  sourceText: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    color: c.link,
  },
  sourceTextHover: { color: '#11832b', textDecorationLine: 'underline' },
});
