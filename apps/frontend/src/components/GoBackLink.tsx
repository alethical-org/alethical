import { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { backLinkProps } from '../navigation/links';
import { theme as t } from '../theme/tokens';

const RESTING_COLOR = '#4b524b';
const ACTIVE_COLOR = '#11150f';

export function GoBackLink({
  href,
  onPress,
  mobile = false,
  outlined = false,
  style,
}: {
  href: string;
  onPress: () => void;
  mobile?: boolean;
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [active, setActive] = useState(false);
  const color = active ? ACTIVE_COLOR : RESTING_COLOR;

  return (
    <Pressable
      {...backLinkProps(href, onPress)}
      accessibilityLabel="Go back"
      onHoverIn={() => setActive(true)}
      onHoverOut={() => setActive(false)}
      onPressIn={() => setActive(true)}
      onPressOut={() => setActive(false)}
      style={[
        styles.link,
        mobile && styles.linkMobile,
        outlined && styles.linkOutlined,
        outlined && active && styles.linkOutlinedActive,
        style,
      ]}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
        <Path
          d="M15 5 L8 12 L15 19"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        style={[
          styles.label,
          mobile && styles.labelMobile,
          outlined && styles.labelOutlined,
          { color: outlined ? ACTIVE_COLOR : color },
        ]}
      >
        Go back
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 9,
  },
  linkMobile: {
    minHeight: 44,
  },
  linkOutlined: {
    minHeight: 44,
    marginBottom: 20,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
  },
  linkOutlinedActive: { borderColor: 'rgba(17,21,15,0.32)' },
  label: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  labelMobile: {
    fontSize: 15,
  },
  labelOutlined: { fontSize: 15.5, fontWeight: '700' },
});
