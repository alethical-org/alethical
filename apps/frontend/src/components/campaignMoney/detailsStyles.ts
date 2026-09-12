import { StyleSheet } from 'react-native';

import { useResponsive } from '../../hooks/useResponsive';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { theme as t } from '../../theme/tokens';

export const detailsStyles = StyleSheet.create({
  section: { gap: 18, minWidth: 0 },
  heading: { fontFamily: t.typography.title, fontSize: 24, fontWeight: '800', color: c.text },
  body: { fontFamily: t.typography.body, fontSize: 17, lineHeight: 26.35, color: c.secondary },
  small: { fontFamily: t.typography.body, fontSize: 15, lineHeight: 22.5, color: c.muted },
  name: { fontFamily: t.typography.body, fontSize: 17, fontWeight: '700', color: c.text },
  amount: {
    fontFamily: t.typography.title,
    fontSize: 17,
    fontWeight: '800',
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  numeric: { fontFamily: t.typography.body, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lettered: { fontFamily: t.typography.mono, fontWeight: '700', fontSize: 10, letterSpacing: 0.8 },
  link: { color: c.link, textDecorationLine: 'underline' },
  control: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    backgroundColor: c.background,
  },
  controlText: { fontFamily: t.typography.body, fontSize: 17, fontWeight: '700', color: c.text },
  focus: { outlineColor: c.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
  horizontal: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rule: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 22 },
});

// Accepted drawing targets at the product's existing 768px and 1100px boundaries.
const typeBands = {
  computer: { h2: 34, h3: 24, body: 17, small: 15, figure: 36, donutCenter: 20, legendMin: 380 },
  tablet: { h2: 30, h3: 22, body: 16, small: 15, figure: 32, donutCenter: 18, legendMin: 320 },
  phone: { h2: 26, h3: 20, body: 15, small: 14, figure: 28, donutCenter: 16, legendMin: 240 },
};

export function useCampaignMoneyTypography() {
  const { isMobile, isTablet } = useResponsive();
  return isMobile ? typeBands.phone : isTablet ? typeBands.tablet : typeBands.computer;
}

export function useDetailsStyles() {
  const type = useCampaignMoneyTypography();
  return {
    ...detailsStyles,
    heading: { ...detailsStyles.heading, fontSize: type.h3 },
    body: { ...detailsStyles.body, fontSize: type.body, lineHeight: type.body * 1.55 },
    small: { ...detailsStyles.small, fontSize: type.small, lineHeight: type.small * 1.5 },
    name: { ...detailsStyles.name, fontSize: type.body, lineHeight: type.body * 1.35 },
    amount: { ...detailsStyles.amount, fontSize: type.body },
    controlText: { ...detailsStyles.controlText, fontSize: type.body },
  };
}

/** Filed text can contain digits too, including a donor name or an employer. */
export function numericText(value: string | number | null | undefined) {
  return value !== null && value !== undefined && /\d/.test(String(value))
    ? detailsStyles.numeric
    : undefined;
}
