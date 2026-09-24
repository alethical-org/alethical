import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useDisclosureStatement } from '../../hooks/useDisclosureStatement';
import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import {
  STATEMENT_BOX_SENTENCE,
  STATEMENT_COLUMNS,
  STATEMENT_FAILED,
  STATEMENT_GROUP_NAME,
  STATEMENT_LABEL,
  STATEMENT_LINE_LABELS,
  STATEMENT_LOADING,
  STATEMENT_NOT_READ,
  STATEMENT_NOT_REPORTED,
  STATEMENT_NOT_YET_READ,
  STATEMENT_PDF_LABEL,
  STATEMENT_REFRESH_FAILED,
  STATEMENT_SCHEDULE,
  UNLINKED_FIELD_LABELS,
  sourcePlace,
  statementDatesLine,
  statementPdfAccessibleName,
  type StatementDetail,
} from '../../lib/disclosureStatementCopy';
import { formatDay, formatMoney } from '../../lib/moneyFormat';
import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { useCampaignMoneyTypography } from './detailsStyles';

/** The outward arrow beside a link to the Board's own PDF. Drawn rather than typed,
 *  because Libre Franklin carries no arrow characters. */
export function OutwardArrow() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M7 17 L17 7 M9 7 H17 V15"
        stroke={c.link}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A link to one of the Board's PDFs, 44px tall, named for its record. */
export function BoardPdfLink({
  url,
  label,
  accessibleName,
}: {
  url: string;
  label: string;
  accessibleName: string;
}) {
  const type = useCampaignMoneyTypography();
  return (
    <Text
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      accessibilityLabel={accessibleName}
      style={[styles.pdfLink, { fontSize: type.small }]}
    >
      {label}
      <Text style={styles.pdfArrow}>
        <OutwardArrow />
      </Text>
    </Text>
  );
}

/** The 4 fields an unlinked statement shows above its details, labelled at every band. */
export interface StatementFields {
  donor: string | null;
  recipient: string | null;
  date: string | null;
  amount: string | null;
}

/**
 * One disclosure statement (#2347; build-facts §3 and §4). Inside the payment it names
 * when it is linked; on the unlinked card, with its 4 fields above, when it is not. Its
 * existence and PDF come with the list; a read statement's details load when it draws,
 * and fail on their own without touching the row or any other statement. A refresh that
 * fails keeps the details loaded earlier under the alert.
 */
export function DisclosureStatementPanel({
  statement,
  donor,
  giftDate,
  fields,
}: {
  statement: { id: string; state: 'read' | 'gift_identified' | 'not_read'; pdfUrl: string };
  donor: string | null;
  giftDate: string | null;
  fields?: StatementFields;
}) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const read = statement.state === 'read';
  const query = useDisclosureStatement(statement.id, read);
  const pdf = (
    <BoardPdfLink
      url={statement.pdfUrl}
      label={STATEMENT_PDF_LABEL}
      accessibleName={statementPdfAccessibleName(donor, giftDate)}
    />
  );
  const small = { fontSize: type.small };
  const retry = (
    <Pressable
      accessibilityRole="button"
      onPress={() => void query.refetch()}
      style={(state) => [
        styles.retry,
        Boolean('focused' in state && state.focused) && styles.focus,
      ]}
    >
      <Text style={[styles.retryText, small]}>Try again</Text>
    </Pressable>
  );
  return (
    <View
      role="group"
      aria-label={STATEMENT_GROUP_NAME}
      style={[
        styles.panel,
        fields && styles.panelListed,
        isTablet && styles.panelTablet,
        isMobile && styles.panelMobile,
      ]}
    >
      <Text style={styles.label}>{STATEMENT_LABEL}</Text>
      {fields ? <FieldList fields={fields} /> : null}
      {!read ? (
        <>
          <Text style={[styles.sentence, small]}>{STATEMENT_NOT_READ}</Text>
          <View style={styles.pdfAlone}>{pdf}</View>
        </>
      ) : query.data ? (
        <>
          {query.isError ? (
            <View role="alert" style={styles.refreshFailed}>
              <Text style={[styles.sentence, small]}>{STATEMENT_REFRESH_FAILED}</Text>
              {retry}
            </View>
          ) : null}
          <ReadStatement detail={query.data} pdf={pdf} />
        </>
      ) : query.isError ? (
        <View role="alert" style={styles.failed}>
          <Text style={[styles.sentence, small]}>{STATEMENT_FAILED}</Text>
          <View style={styles.failedActions}>
            {retry}
            {pdf}
          </View>
        </View>
      ) : (
        <View role="status" aria-busy style={styles.loading}>
          <Text style={[styles.sentence, small]}>{STATEMENT_LOADING}</Text>
          <View style={[styles.bar, { width: '72%' }]} />
          <View style={[styles.bar, { width: '48%' }]} />
        </View>
      )}
    </View>
  );
}

/** Donor · Recipient · Contribution date · Contribution amount, each labelled, each
 *  "Not yet read" where no reading holds it. A description list, so nothing is lost
 *  when the columns stack. */
function FieldList({ fields }: { fields: StatementFields }) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const narrow = isMobile || isTablet;
  const items = [
    [UNLINKED_FIELD_LABELS.donor, fields.donor, 1.6],
    [UNLINKED_FIELD_LABELS.recipient, fields.recipient, 1.1],
    [UNLINKED_FIELD_LABELS.date, formatDay(fields.date), 0.8],
    [UNLINKED_FIELD_LABELS.amount, formatMoney(fields.amount), 0.8],
  ] as const;
  return (
    <View role="list" style={[styles.fields, narrow && styles.fieldsNarrow]}>
      {items.map(([label, value, grow], index) => (
        <View
          key={label}
          role="listitem"
          style={[
            styles.field,
            narrow ? (isMobile && index < 2 ? styles.fieldFull : styles.fieldHalf) : { flex: grow },
          ]}
        >
          <Text style={[styles.fieldLabel, { fontSize: type.small }]}>{label}</Text>
          <Text style={[value ? styles.fieldValue : styles.fieldMissing, { fontSize: type.small }]}>
            {value ?? STATEMENT_NOT_YET_READ}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReadStatement({ detail, pdf }: { detail: StatementDetail; pdf: ReactNode }) {
  const { isMobile, isTablet } = useResponsive();
  const type = useCampaignMoneyTypography();
  const small = { fontSize: type.small };
  const wide = !isMobile;
  // Schedule A1's city and amount columns: 240 and 170 on a computer, 190 and 140 on a
  // tablet, stacked on a phone (build-facts §4).
  const columns = isMobile ? null : isTablet ? [190, 140] : [240, 170];
  const lines = [
    [STATEMENT_LINE_LABELS.a, detail.lineA],
    [STATEMENT_LINE_LABELS.b, detail.lineB],
    [STATEMENT_LINE_LABELS.c, detail.lineC],
  ] as const;
  return (
    <>
      {detail.box ? (
        <Text style={[styles.sentence, small]}>{STATEMENT_BOX_SENTENCE[detail.box]}</Text>
      ) : null}
      {detail.box === 3 ? (
        <>
          <View style={styles.schedule}>
            <Text style={[styles.scheduleHead, small]}>{STATEMENT_SCHEDULE}</Text>
            <View role="table" aria-label={STATEMENT_SCHEDULE} style={styles.table}>
              {wide ? (
                <View role="row" style={[styles.tableRow, styles.tableHeadRow]}>
                  <Text role="columnheader" style={[styles.columnHead, styles.nameCell]}>
                    {STATEMENT_COLUMNS[0]}
                  </Text>
                  <Text role="columnheader" style={[styles.columnHead, { width: columns![0] }]}>
                    {STATEMENT_COLUMNS[1]}
                  </Text>
                  <Text
                    role="columnheader"
                    style={[styles.columnHead, styles.amountHead, { width: columns![1] }]}
                  >
                    {STATEMENT_COLUMNS[2]}
                  </Text>
                </View>
              ) : null}
              {detail.sources.map((source, index) =>
                wide ? (
                  <View key={index} role="row" style={[styles.tableRow, styles.sourceRow]}>
                    <Text role="cell" style={[styles.sourceName, styles.nameCell, small]}>
                      {source.name}
                    </Text>
                    <Text role="cell" style={[styles.sourcePlace, small, { width: columns![0] }]}>
                      {sourcePlace(source)}
                    </Text>
                    <Text
                      role="cell"
                      style={[
                        styles.sourceAmount,
                        styles.amountCell,
                        small,
                        { width: columns![1] },
                      ]}
                    >
                      {formatMoney(source.amount) ?? STATEMENT_NOT_REPORTED}
                    </Text>
                  </View>
                ) : (
                  // On the phone each cell keeps its column name as its header.
                  <View key={index} role="row" style={[styles.sourceRow, styles.stacked]}>
                    {[
                      [STATEMENT_COLUMNS[0], source.name, styles.sourceName],
                      [STATEMENT_COLUMNS[1], sourcePlace(source), styles.sourcePlace],
                      [
                        STATEMENT_COLUMNS[2],
                        formatMoney(source.amount) ?? STATEMENT_NOT_REPORTED,
                        styles.sourceAmount,
                      ],
                    ].map(([header, value, style]) => (
                      <View key={header as string} role="cell" style={styles.stackedCell}>
                        <Text style={styles.columnHead}>{header as string}</Text>
                        <Text style={[style as object, small]}>{value as string}</Text>
                      </View>
                    ))}
                  </View>
                ),
              )}
            </View>
          </View>
          <View style={[styles.lines, isMobile && styles.linesStacked]}>
            {lines.map(([label, value]) => (
              <View key={label} style={[styles.line, !isMobile && styles.lineWide]}>
                <Text style={[styles.lineLabel, small]}>{label}</Text>
                {value === null ? (
                  <Text style={[styles.lineMissing, small]}>{STATEMENT_NOT_REPORTED}</Text>
                ) : (
                  <Text style={[styles.lineValue, small]}>{formatMoney(value)}</Text>
                )}
              </View>
            ))}
          </View>
        </>
      ) : null}
      <View style={[styles.foot, isMobile && styles.footStacked]}>
        <Text style={[styles.dates, small]}>
          {statementDatesLine(detail.signedOn, detail.receivedOn)}
        </Text>
        {pdf}
      </View>
    </>
  );
}

const tabular = { fontVariant: ['tabular-nums'] as ['tabular-nums'] };

const styles = StyleSheet.create({
  panel: {
    marginTop: 10,
    backgroundColor: '#f7f8fa',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 12,
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  panelTablet: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 14 },
  panelMobile: { paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12 },
  label: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: c.secondary,
  },
  sentence: {
    marginTop: 10,
    fontFamily: t.typography.body,
    lineHeight: 21,
    color: c.secondary,
    ...tabular,
  },
  pdfAlone: { marginTop: 10, alignItems: 'flex-start' },
  loading: { marginTop: 10, gap: 9, alignItems: 'flex-start' },
  bar: { height: 11, borderRadius: 5, backgroundColor: '#e3e6e4' },
  failed: { marginTop: 10, gap: 12 },
  refreshFailed: {
    marginTop: 10,
    paddingBottom: 12,
    gap: 10,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  panelListed: { marginTop: 0 },
  fields: {
    marginTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    columnGap: 20,
    rowGap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  fieldsNarrow: { flexWrap: 'wrap' },
  field: { gap: 2, minWidth: 0 },
  fieldHalf: { flexBasis: '45%', flexGrow: 1 },
  fieldFull: { flexBasis: '100%' },
  fieldLabel: { fontFamily: t.typography.body, color: c.muted },
  fieldValue: {
    fontFamily: t.typography.body,
    fontWeight: '700',
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  fieldMissing: { fontFamily: t.typography.body, fontWeight: '500', color: c.secondary },
  failedActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  retry: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: c.text,
    justifyContent: 'center',
    ...({ outlineStyle: 'none' } as object),
  },
  retryText: { fontFamily: t.typography.body, fontWeight: '800', color: '#ffffff' },
  focus: { outlineColor: c.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
  pdfLink: {
    minHeight: 44,
    ...({ display: 'inline-flex', alignItems: 'center' } as object),
    fontFamily: t.typography.body,
    fontWeight: '700',
    color: c.link,
    textDecorationLine: 'underline',
  },
  pdfArrow: {
    marginLeft: 4,
    ...({ display: 'inline-flex', verticalAlign: 'middle' } as object),
  },
  schedule: { marginTop: 14 },
  scheduleHead: { fontFamily: t.typography.body, fontWeight: '800', color: c.text },
  table: { marginTop: 6 },
  tableRow: { flexDirection: 'row', columnGap: 14 },
  tableHeadRow: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.12)',
  },
  columnHead: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.96,
    textTransform: 'uppercase',
    color: c.muted,
  },
  amountHead: { textAlign: 'right' },
  nameCell: { flex: 1, minWidth: 0 },
  sourceRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.06)',
  },
  sourceName: { fontFamily: t.typography.body, fontWeight: '700', color: c.text },
  sourcePlace: { fontFamily: t.typography.body, color: c.secondary },
  sourceAmount: { fontFamily: t.typography.body, fontWeight: '800', color: c.text, ...tabular },
  amountCell: { textAlign: 'right' },
  stacked: { gap: 6 },
  stackedCell: { gap: 2 },
  lines: { marginTop: 12, flexDirection: 'row', columnGap: 20, rowGap: 10 },
  linesStacked: { flexDirection: 'column' },
  line: { gap: 2, minWidth: 0 },
  lineWide: { flex: 1 },
  lineLabel: { fontFamily: t.typography.body, lineHeight: 20, color: c.secondary },
  lineValue: { fontFamily: t.typography.body, fontWeight: '800', color: c.text, ...tabular },
  lineMissing: { fontFamily: t.typography.body, fontWeight: '500', color: c.secondary },
  foot: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 18,
    rowGap: 8,
  },
  footStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  dates: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    color: c.secondary,
    ...tabular,
  },
});
