import { StyleSheet, Text } from 'react-native';

/**
 * The one decorative trailing arrow for phone and desktop text links.
 * Nest it inside the label's Text so the glyph inherits that label's size, line height,
 * color, and baseline. Keep the one normal space in the caller.
 */
export function LinkArrow() {
  return (
    <Text aria-hidden style={styles.arrow} testID="link-arrow">
      →
    </Text>
  );
}

const styles = StyleSheet.create({
  arrow: { fontWeight: '400' },
});
