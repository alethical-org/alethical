import { Pressable, StyleSheet, Text, View } from 'react-native';
import { finePointerHovered } from '../campaignMoney/finePointerHover';
import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import type { QueueRow as Row } from './api';
import { centralDate } from './types';

const STATUS: Record<string, string> = {
  unprepared: 'Not prepared',
  draft: 'Draft',
  approved: 'Approved',
  withdrawn: 'Withdrawn',
};

/** One queue file as a single control, the same pattern as the /money/ads folder rows. */
export function QueueRow({
  row,
  disabled,
  onOpen,
}: {
  row: Row;
  disabled: boolean;
  onOpen(): void;
}) {
  const reasons = [
    ...(row.checked_agency_names ?? []).map((name) => `Agency name already checked: ${name}`),
    ...(row.folder_committees ?? []).map((name) => `Folder checked as relating to ${name}`),
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${row.name}`}
      disabled={disabled}
      onPress={onOpen}
      style={(state) => [
        styles.row,
        finePointerHovered(state) && !disabled && styles.hover,
        finePointerHovered(state) && !disabled && !prefersReducedMotion() && styles.lift,
        disabled && { opacity: 0.6 },
      ]}
    >
      <View style={styles.main}>
        <Text style={styles.name}>
          {row.call_sign} · {row.name}
        </Text>
        {reasons.map((reason) => (
          <Text key={reason} style={styles.reason}>
            {reason}
          </Text>
        ))}
        <Text style={styles.meta}>
          {[
            row.folder_path,
            `First saved ${centralDate(row.first_saved_at)}`,
            row.uploaded_at
              ? `Source upload ${centralDate(row.uploaded_at)}`
              : 'Upload date unavailable',
            `${row.page_count} ${row.page_count === 1 ? 'page' : 'pages'}`,
            STATUS[row.status] ?? row.status,
          ].join(' · ')}
        </Text>
      </View>
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flex: 'none' }}
      >
        <path
          d="M5 12 H19 M14 7 L19 12 L14 17"
          stroke={t.colors.text.muted}
          strokeWidth="2.27"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Pressable>
  );
}

const wrap = { overflowWrap: 'anywhere' } as object;
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    minHeight: 64,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 17,
    ...(t.shadows.card as object),
    ...({
      transition: 'transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease',
    } as object),
  },
  hover: {
    borderColor: 'rgba(45,212,126,0.85)',
    ...({ boxShadow: '0 22px 46px rgba(17,21,15,0.14)' } as object),
  },
  lift: { transform: [{ translateY: -3 }] },
  main: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: '#11150f',
    ...wrap,
  },
  reason: {
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 23,
    color: '#2c322c',
    marginTop: 4,
    ...wrap,
  },
  meta: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: '#4f5651',
    marginTop: 6,
    fontVariant: ['tabular-nums'],
    ...wrap,
  },
});
