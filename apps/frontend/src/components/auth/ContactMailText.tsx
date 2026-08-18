import { Linking, Platform, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import { theme as t } from '../../theme/tokens';

export const CONTACT_EMAIL = 'ask@alethical.com';
const MAILTO = `mailto:${CONTACT_EMAIL}`;
const isWeb = Platform.OS === 'web';

/**
 * A message with ask@alethical.com rendered as a real mail link wherever it
 * appears — a sentence that names a human contact must let the reader press it
 * (rev 17 sign-in bundle, #1533).
 */
export function ContactMailText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const parts = text.split(CONTACT_EMAIL);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;
  const children: React.ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      children.push(
        <Text
          key={`link-${index}`}
          accessibilityRole="link"
          {...(isWeb ? ({ href: MAILTO } as object) : null)}
          onPress={isWeb ? undefined : () => void Linking.openURL(MAILTO)}
          style={styles.link}
        >
          {CONTACT_EMAIL}
        </Text>,
      );
    }
    if (part) children.push(part);
  });
  return <Text style={style}>{children}</Text>;
}

const styles = StyleSheet.create({
  link: {
    color: t.colors.text.greenOnLight,
    fontWeight: t.fontWeights.semibold,
    textDecorationLine: 'underline',
  },
});
