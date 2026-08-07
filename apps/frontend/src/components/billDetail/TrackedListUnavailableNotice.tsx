import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBillTracking } from '../../hooks/useBillTracking';
import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// The page half of the failed-watchlist treatment (#1021). The button carries the way
// out; the page carries the sentence, once.
//
// Deliberately GREY and `role="status"`, never red and never `role="alert"`: nothing is
// broken, one thing is missing. And it says outright that the bills themselves loaded,
// because a reader who sees a failure notice on a page full of bill data will otherwise
// assume the records are the thing that went wrong.
//
// Renders nothing unless a signed-in reader's watchlist actually failed with no list to
// fall back on, which `useBillTracking` derives from the same state the buttons use, so
// the notice and the outlined buttons can never disagree.
//
// Scope, recorded so it does not read as an oversight: this ships on the tracked-bills
// page only. That is the page where the saved list is the entire point, so its absence
// is most consequential there. On search, the bill page, the home feed and the Ask
// answer card the outlined button alone still asserts nothing and still fixes on press,
// so nothing dishonest ships without it. Whether the notice belongs on those surfaces
// too is with Design.
export function TrackedListUnavailableNotice() {
  const { listUnavailable, writeUnavailable, recheck, retryFailedWrites } = useBillTracking();
  const [hovered, hover] = useHover();

  if (!listUnavailable && !writeUnavailable) return null;

  return (
    <View
      // 'status' is polite: it reaches a screen reader without interrupting, which is
      // right for a missing sidecar rather than a failure of the page.
      accessibilityRole={isWeb ? ('status' as 'none') : 'text'}
      accessibilityLiveRegion="polite"
      style={styles.notice}
    >
      <Text style={styles.text}>
        {writeUnavailable
          ? 'We couldn’t save that Track change. Everything about the bills themselves loaded normally.'
          : 'We couldn’t check which bills you’re tracking. Everything about the bills themselves loaded normally — only your saved list is missing.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check again which bills you’re tracking"
        onPress={() => (writeUnavailable ? retryFailedWrites() : recheck())}
        {...hover}
        style={[styles.action, hovered && styles.actionHover]}
      >
        <Text style={styles.actionText}>{writeUnavailable ? 'Try again' : 'Check again'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginTop: 18,
    maxWidth: 760,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    backgroundColor: '#f7f8fa',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.md,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  text: {
    flex: 1,
    minWidth: 240,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  action: {
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.32)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    ...(isWeb
      ? ({
          transitionProperty: 'background-color, border-color',
          transitionDuration: '0.15s',
        } as object)
      : null),
  },
  actionHover: { backgroundColor: '#eceef1', borderColor: '#11150f' },
  actionText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
});
