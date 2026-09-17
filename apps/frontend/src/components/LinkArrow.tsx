import { StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The approved spacing and vertical alignment for a green link followed by an arrow.
 * Keep the text and LinkArrow as siblings inside the same row.
 */
export const linkArrowRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
};

export const GREEN_LINK_ARROW_COLOR = '#0f7a45';

/**
 * The approved treatment for a label that may wrap. The last word and arrow stay
 * together, while the arrow keeps the same 6px space and centered position.
 */
export function LinkArrowLabel({ label, style }: { label: string; style?: StyleProp<TextStyle> }) {
  const lastSpace = label.lastIndexOf(' ');
  const start = lastSpace < 0 ? '' : `${label.slice(0, lastSpace)} `;
  const end = lastSpace < 0 ? label : label.slice(lastSpace + 1);
  return (
    <Text style={style}>
      {start}
      <Text style={styles.keepTogether}>
        {end}
        <LinkArrow color={GREEN_LINK_ARROW_COLOR} style={styles.inlineArrow} />
      </Text>
    </Text>
  );
}

/** The approved arrow for a green link whose label and arrow are separate siblings. */
export function GreenLinkArrow() {
  return <LinkArrow color={GREEN_LINK_ARROW_COLOR} />;
}

/**
 * The one trailing arrow for phone and desktop links.
 *
 * Libre Franklin does not include the right-arrow text character. Browsers therefore
 * choose a different fallback font on each operating system, making the phone arrow
 * shorter and lower than the desktop arrow. Drawing it keeps the shape and alignment
 * identical everywhere.
 */
export function LinkArrow({ color, style }: { color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      style={StyleSheet.flatten([styles.arrow, style])}
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
  // The surrounding layout owns vertical centering. A shared top offset cannot serve
  // both an inline label and a separate flex-row arrow: it moves one of them twice.
  arrow: { flexShrink: 0, pointerEvents: 'none' },
  // The last word and arrow are one unbreakable inline flex group. Centering inside
  // that group follows the label's own line box at every supported text size.
  keepTogether: {
    ...({
      whiteSpace: 'nowrap',
      display: 'inline-flex',
      alignItems: 'center',
      verticalAlign: 'baseline',
    } as object),
  },
  inlineArrow: { marginLeft: 6 },
});
