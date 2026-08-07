import { Linking, StyleSheet, Text, View } from 'react-native';

import { externalLinkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

const LEGISLATURE_URL = 'https://www.leg.mn.gov/';
const REVISOR_URL = 'https://www.revisor.mn.gov/';

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
  const updated = updatedLabel.trim();
  return (
    <View style={styles.line}>
      <Text style={styles.text}>
        Source:{' '}
        <Text
          {...externalLinkProps(LEGISLATURE_URL, () => {
            Linking.openURL(LEGISLATURE_URL).catch(() => {});
          })}
          style={styles.link}
        >
          Minnesota Legislature
        </Text>{' '}
        ·{' '}
        <Text
          {...externalLinkProps(REVISOR_URL, () => {
            Linking.openURL(REVISOR_URL).catch(() => {});
          })}
          style={styles.link}
        >
          revisor.mn.gov
        </Text>
        {updated ? ` · ${updated}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    marginTop: 52,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink07,
  },
  text: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  link: { color: t.colors.text.secondary, textDecorationLine: 'underline' },
});
