import { StyleSheet, Text } from 'react-native';

import { theme as t } from '../../theme/tokens';

// One quiet source line closing every tab (spec §Source line). Mono grey, hairline
// top border, sitting subtly on its own.
export function SourceLine({ text }: { text: string }) {
  return <Text style={styles.line}>{text}</Text>;
}

const styles = StyleSheet.create({
  line: {
    marginTop: 52,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink07,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    color: t.colors.text.muted,
  },
});
