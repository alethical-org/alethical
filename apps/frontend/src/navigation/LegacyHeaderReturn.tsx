import { ArrowLeft } from '../components/icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme/tokens';

/** Only the retained Vote Detail and Chat Session headers use this control. */
export default function LegacyHeaderReturn({
  voteDetail,
  onPress,
}: {
  voteDetail: boolean;
  onPress: () => void;
}) {
  const label = voteDetail ? 'Back to Search bills' : 'Back to Home';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
    >
      <ArrowLeft color={theme.colors.ink} size={32} strokeWidth={2.4} aria-hidden />
      <Text>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 40,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backButtonPressed: { opacity: 0.72 },
});
