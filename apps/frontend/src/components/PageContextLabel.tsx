import { StyleSheet, Text, type TextProps } from 'react-native';

/**
 * The green label below a page's back link.
 *
 * The source words stay in sentence case for screen readers and reuse, while
 * the approved visual treatment always draws them in capitals.
 */
export function PageContextLabel({ style, testID = 'page-context-label', ...props }: TextProps) {
  return <Text {...props} testID={testID} style={[style, styles.uppercase]} />;
}

const styles = StyleSheet.create({
  uppercase: { textTransform: 'uppercase' },
});
