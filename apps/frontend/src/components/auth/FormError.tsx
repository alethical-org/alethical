import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';

function ErrorIcon() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={12} cy={12} r={9} stroke={t.colors.dangerRamp.r600} strokeWidth={2} />
      <Path
        d="M12 7.5 V13"
        stroke={t.colors.dangerRamp.r600}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={16.3} r={1.15} fill={t.colors.dangerRamp.r600} />
    </Svg>
  );
}

export function FormError({
  id,
  message,
  variant = 'field',
}: {
  id?: string;
  message: string;
  variant?: 'field' | 'banner';
}) {
  if (variant === 'banner') {
    return (
      <View nativeID={id} accessibilityRole="alert" style={styles.banner}>
        <View style={styles.icon}>
          <ErrorIcon />
        </View>
        <Text style={styles.bannerText}>{message}</Text>
      </View>
    );
  }

  return (
    <Text nativeID={id} accessibilityLiveRegion="polite" style={styles.fieldText}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  fieldText: {
    marginTop: 7,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.omnibus.text,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: '#fdecec',
    borderWidth: 1,
    borderColor: '#f4c9c6',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  icon: { marginTop: 1 },
  bannerText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.dangerRamp.r800,
  },
});
