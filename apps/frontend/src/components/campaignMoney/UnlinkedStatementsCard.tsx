import { useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnlinkedStatements } from '../../hooks/useDisclosureStatement';
import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import {
  UNLINKED_FAILED,
  UNLINKED_HEADING,
  UNLINKED_LEAD,
  UNLINKED_LOADING,
  UNLINKED_REFRESH_FAILED,
} from '../../lib/disclosureStatementCopy';
import { theme as t } from '../../theme/tokens';
import { Skeleton } from '../Skeleton';
import { DisclosureStatementPanel } from './DisclosureStatementPanel';

const band = {
  computer: { pad: { paddingTop: 30, paddingHorizontal: 32, paddingBottom: 28 }, h: 24, body: 17 },
  tablet: { pad: { paddingTop: 26, paddingHorizontal: 26, paddingBottom: 24 }, h: 22, body: 16 },
  phone: { pad: { paddingVertical: 20, paddingHorizontal: 18 }, h: 20, body: 15 },
};

/**
 * Statements not linked to a payment, directly after the notices card (#2347,
 * build-facts §4). Read on its own, so the payment list's search, contributor tabs and
 * failures never hide a statement. Drawn while it loads and when it fails; absent only
 * once a successful answer says every statement for the year is linked. Nothing on it is
 * added to anything, and no statement is attached to a guessed payment.
 */
export function UnlinkedStatementsCard({
  registrationNumber,
  year,
}: {
  registrationNumber: string;
  year: number;
}) {
  const query = useUnlinkedStatements(registrationNumber, year);
  const { isMobile, isTablet } = useResponsive();
  const size = isMobile ? band.phone : isTablet ? band.tablet : band.computer;
  const headingId = useId();
  if (query.data && query.data.statements.length === 0 && !query.isError) return null;
  const retry = (
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
  );
  return (
    <View
      role="region"
      aria-labelledby={headingId}
      testID="unlinked-statements"
      style={[styles.card, size.pad]}
    >
      <Text
        nativeID={headingId}
        accessibilityRole="header"
        aria-level={2}
        style={[styles.heading, { fontSize: size.h }]}
      >
        {UNLINKED_HEADING}
      </Text>
      <Text style={[styles.lead, { fontSize: size.body }]}>{UNLINKED_LEAD}</Text>
      {query.data ? (
        <>
          {query.isError ? (
            <View role="alert" style={styles.stateBlock}>
              <Text style={[styles.lead, { fontSize: size.body }]}>{UNLINKED_REFRESH_FAILED}</Text>
              {retry}
            </View>
          ) : null}
          <View role="list" style={styles.list}>
            {query.data.statements.map((statement) => (
              <View key={statement.id} role="listitem">
                <DisclosureStatementPanel
                  statement={statement}
                  donor={statement.donorName}
                  giftDate={statement.giftDate}
                  fields={{
                    donor: statement.donorName,
                    recipient: statement.recipientName,
                    date: statement.giftDate,
                    amount: statement.giftAmount,
                  }}
                />
              </View>
            ))}
          </View>
        </>
      ) : query.isError ? (
        <View role="alert" style={styles.stateBlock}>
          <Text style={[styles.lead, { fontSize: size.body }]}>{UNLINKED_FAILED}</Text>
          {retry}
        </View>
      ) : (
        <View role="status" aria-busy style={styles.stateBlock}>
          <Text style={[styles.lead, { fontSize: size.body }]}>{UNLINKED_LOADING}</Text>
          <View style={styles.skeletons}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="80%" height={11} />
          </View>
        </View>
      )}
    </View>
  );
}

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
  list: { marginTop: 22, gap: 14 },
  stateBlock: { marginTop: 12, gap: 14, alignItems: 'flex-start' },
  skeletons: { alignSelf: 'stretch', gap: 10 },
  retry: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: c.text,
    justifyContent: 'center',
    ...({ outlineStyle: 'none' } as object),
  },
  retryText: { fontFamily: t.typography.body, fontSize: 15, fontWeight: '800', color: '#ffffff' },
  focus: { outlineColor: c.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
});
