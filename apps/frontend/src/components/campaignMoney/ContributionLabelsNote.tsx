import { StyleSheet, Text } from 'react-native';

import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { type DekSegment } from '../../lib/campaignMoneyDetailsPageCopy';
import { useDetailsStyles } from './detailsStyles';

/**
 * The dek above the money cards, with the 2 figure labels in the weight the cards set
 * them in.
 *
 * Its own small file, in the eagerly loaded part of the app, because it has 2 homes. The
 * donor chart draws it with the sentence describing the donut; the chart arrives in a
 * separately downloaded piece, so while that piece is on its way — or fails — the same
 * sentences have to draw beside the figures without it. `.claude/rules/grounded-answers.md`
 * rule 12 asks a page carrying both contribution figures to say what the difference
 * between them is, and a loading picture is no reason for a reader to be told less.
 *
 * Draws nothing when handed no segments, which is every state with only 1 contribution
 * figure on the page.
 */
export function Dek({ segments }: { segments: readonly DekSegment[] }) {
  const s = useDetailsStyles();
  if (segments.length === 0) return null;
  return (
    <Text style={[s.small, { maxWidth: 900 }]}>
      {segments.map((segment, index) => (
        <Text key={index} style={segment.bold ? styles.term : undefined}>
          {segment.bold && segment.text === 'non-itemized contributions' ? (
            <>
              <Text style={{ whiteSpace: 'nowrap' } as import('react-native').TextStyle}>
                non-itemized
              </Text>{' '}
              contributions
            </>
          ) : (
            segment.text
          )}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  term: { fontWeight: '700', color: c.text },
});
