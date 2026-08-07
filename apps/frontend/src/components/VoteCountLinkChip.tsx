import { Platform, Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../hooks/useResponsive';
import { linkProps } from '../navigation/links';
import { theme as t } from '../theme/tokens';
import { useHover } from './billDetail/interactions';

export function VoteCountLinkChip({
  count,
  href,
  onPress,
}: {
  count: number;
  href: string;
  onPress: (event: GestureResponderEvent) => void;
}) {
  const { isMobile } = useResponsive();
  const [hovered, hover] = useHover();

  if (count <= 0) return null;

  const label = `${count} ${count === 1 ? 'VOTE' : 'VOTES'}`;

  return (
    <Pressable
      {...linkProps(href, onPress)}
      accessibilityLabel={`${label}, view roll calls`}
      {...hover}
      style={[styles.chip, isMobile && styles.chipMobile, hovered && styles.chipHover]}
    >
      <Svg
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        color={t.colors.brand.deep}
        aria-hidden
      >
        <Path
          d="M5 20 V10 M12 20 V4 M19 20 V14"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.label, isMobile && styles.labelMobile]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 11,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 8,
    ...(Platform.OS === 'web'
      ? ({ display: 'inline-flex', textDecorationLine: 'none', whiteSpace: 'nowrap' } as object)
      : null),
  },
  chipMobile: {
    minHeight: 44,
    paddingVertical: 0,
    paddingLeft: 9,
    paddingRight: 12,
  },
  chipHover: { borderColor: t.colors.brand.base },
  label: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.33,
    color: t.colors.brand.deep,
    ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  labelMobile: { fontSize: 12 },
});
