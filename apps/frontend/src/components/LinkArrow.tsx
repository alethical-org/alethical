import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The one trailing arrow for phone and desktop links.
 *
 * Libre Franklin does not include the right-arrow text character. Browsers therefore
 * choose a different fallback font on each operating system, making the phone arrow
 * shorter and lower than the desktop arrow. Drawing it keeps the shape and alignment
 * identical everywhere.
 */
export function LinkArrow({ color }: { color: string }) {
  return (
    <Svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      style={styles.arrow}
      aria-hidden
      testID="link-arrow"
    >
      <Path
        d="M3.5 12 H19.5 M13 6 L19.5 12 L13 18"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // The 1px optical nudge centers the mark on the neighboring letters' x-height.
  arrow: { position: 'relative', top: 1, flexShrink: 0, pointerEvents: 'none' },
});
