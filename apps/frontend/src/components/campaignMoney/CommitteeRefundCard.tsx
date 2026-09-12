import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CommitteeRefunds } from '../../data/types';
import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { refundCopy as copy, visibleRefundYears } from '../../lib/committeeRefunds';
import { formatDay, formatMoney } from '../../lib/legislatorCampaignMoney';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { committeeCardStyles, detailsStyles, useCampaignMoneyTypography } from './detailsStyles';

type Props = { refunds: CommitteeRefunds | undefined; registrationNumber: string };

/** All refund years for exactly the confirmed committee whose card precedes this one. */
export function CommitteeRefundCard({ refunds, registrationNumber }: Props) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  if (!refunds) return null; // An older cached response does not establish an empty history.
  const rows = visibleRefundYears(refunds);
  const reported = rows.filter((row) => row.state === 'reported');
  // This is one note about the table, so every displayed source must support it.
  const jointNote =
    reported.length > 0 && reported.every((row) => row.jointFilingCountsAsOne === true);
  const copiedDay = formatDay(refunds.copiedOn);
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
    padding: '0 0 10px',
    borderBottom: '1px solid rgba(17,21,15,0.16)',
    textAlign: 'right',
    verticalAlign: 'bottom',
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
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
        aria-level={3}
        style={[styles.heading, { fontSize: type.h3 }]}
      >
        {copy.heading}
      </Text>
      <Text
        style={[styles.body, { fontSize: type.body, lineHeight: type.body * 1.55, marginTop: 12 }]}
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
              <th scope="col" style={{ ...head, textAlign: 'left', width: '20%' }}>
                {copy.columns[0]}
              </th>
              <th scope="col" style={{ ...head, width: '42%', paddingLeft: 8, paddingRight: 8 }}>
                {copy.columns[1]}
              </th>
              <th scope="col" style={{ ...head, width: '38%' }}>
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
                          paddingLeft: 8,
                          paddingRight: 8,
                          ...(row.contributionsRefunded === null
                            ? { color: c.secondary, fontSize: type.small }
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
        {copiedDay ? (
          refunds.sourceUrl ? (
            <Pressable
              {...externalLinkProps(
                refunds.sourceUrl,
                () => void Linking.openURL(refunds.sourceUrl!),
              )}
              style={(state) => [
                styles.sourceLink,
                Boolean('focused' in state && state.focused) && detailsStyles.focus,
              ]}
            >
              <Text
                style={[styles.sourceText, { fontSize: type.small, lineHeight: type.small * 1.5 }]}
              >
                {copy.copiedOn(copiedDay)}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.body, { fontSize: type.small, lineHeight: type.small * 1.5 }]}>
              {copy.copiedOn(copiedDay)}
            </Text>
          )
        ) : null}
      </View>
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
    maxWidth: 820,
  },
  notes: { marginTop: 18, gap: 7 },
  sourceLink: {
    alignSelf: 'flex-start',
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
});
