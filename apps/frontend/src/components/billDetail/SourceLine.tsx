import { StyleSheet, Text } from 'react-native';

import { theme as t } from '../../theme/tokens';

// Exactly three parts — source, domain, updated date — built HERE rather than by
// each caller, so the line cannot drift tab by tab. It is a provenance footer for
// the whole page, not a caption for one tab: naming a different record type per tab
// ("bill status records" on Actions, "roll-call records" on Votes) read as if the
// tabs came from different sources. `updatedLabel` is the bill's one last-updated
// stamp; when the bill has none the segment is dropped rather than filled in.
export function billSourceText(updatedLabel: string): string {
  const updated = updatedLabel.trim();
  return `Source: Minnesota Legislature · revisor.mn.gov${updated ? ` · ${updated}` : ''}`;
}

// One quiet source line closing every tab (spec §Source line). Mono grey, hairline
// top border, sitting subtly on its own.
export function SourceLine({ updatedLabel }: { updatedLabel: string }) {
  return <Text style={styles.line}>{billSourceText(updatedLabel)}</Text>;
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
