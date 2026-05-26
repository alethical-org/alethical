import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { ScreenView } from '../components/ScreenView';
import { useBill, useLegislators } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'VoteDetail'>;

export function VoteDetailScreen({ route }: Props) {
  const billQuery = useBill(route.params.billId);
  const legislatorsQuery = useLegislators();

  const bill = billQuery.data;
  const vote = bill?.votes.find((item) => item.id === route.params.voteEventId);

  return (
    <ScreenView
      title="Vote Detail"
      subtitle={bill ? `${bill.identifier} ${bill.title}` : 'Vote event overview'}
    >
      {!vote ? (
        <Card>
          <Text style={styles.bodyText}>This vote event is not available from the live data source yet.</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.title}>{vote.motion}</Text>
            <Text style={styles.bodyText}>{vote.date}</Text>
            <Text style={styles.bodyText}>{vote.result}</Text>
            <Text style={styles.bodyText}>
              Yes {vote.breakdown.yes} | No {vote.breakdown.no} | Absent {vote.breakdown.absent}
            </Text>
          </Card>
          <View style={styles.stack}>
            {vote.votes.map((individualVote) => {
              const legislator = legislatorsQuery.data?.find(
                (item) => item.id === individualVote.legislatorId
              );
              return (
                <Card key={individualVote.legislatorId}>
                  <Text style={styles.title}>{legislator?.name ?? individualVote.legislatorId}</Text>
                  <Text style={styles.bodyText}>
                    {legislator?.party ?? ''} | District {legislator?.district ?? ''}
                  </Text>
                  <Text style={styles.bodyText}>{individualVote.vote}</Text>
                </Card>
              );
            })}
          </View>
        </>
      )}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.md,
  },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
});
