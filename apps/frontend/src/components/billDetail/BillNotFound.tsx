import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { useHover } from './interactions';

/**
 * The bill does not exist — a distinct state from "we couldn't load it" (#720).
 *
 * A stale bookmark, a shared link to a bill that was removed, or a hand-typed key
 * is the ordinary case here, and the API answers those with a plain 404. Telling
 * someone to "try again in a moment" sends them to wait for something that will
 * never load, and reads as our site being broken rather than the link being wrong.
 * So this names what happened, quotes the key they asked for so they can see the
 * typo, and gives them somewhere to go.
 *
 * Shared by both bill screens so a bad link behaves identically on a phone and a
 * laptop, which is the half of this that would otherwise drift.
 */
export function BillNotFound({
  billId,
  onBrowseBills,
  onAsk,
}: {
  billId?: string;
  onBrowseBills: () => void;
  onAsk?: () => void;
}) {
  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={styles.heading}>
        We couldn’t find that bill
      </Text>
      <Text style={styles.body}>
        {billId
          ? `Nothing in the Minnesota Legislature’s records matches ${billId}. The link may be mistyped, or point to a bill we don’t carry.`
          : 'Nothing in the Minnesota Legislature’s records matches that link. It may be mistyped, or point to a bill we don’t carry.'}
      </Text>
      <View style={styles.actions}>
        <WayOut label="Browse all bills →" onPress={onBrowseBills} />
        {onAsk ? <WayOut label="Ask a question →" onPress={onAsk} /> : null}
      </View>
    </View>
  );
}

function WayOut({ label, onPress }: { label: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hover}>
      <Text style={[styles.wayOut, hovered && styles.wayOutHover]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 64, paddingHorizontal: 20, alignItems: 'center', gap: 12 },
  heading: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 26,
    color: t.colors.text.muted,
    textAlign: 'center',
    maxWidth: 460,
  },
  actions: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 24,
  },
  wayOut: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
  wayOutHover: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
});
