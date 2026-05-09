import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useChatSessions } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Chat'>;

export function ChatListScreen({ navigation }: Props) {
  const { isSignedIn, user, signInDemo } = useAuth();
  const sessionsQuery = useChatSessions(user?.id);

  if (!isSignedIn) {
    return (
      <ScreenView title="Grounded Chat" subtitle="Chat is signed-in only so your conversations, tracked bills, and saved context stay connected.">
        <Card>
          <Text style={styles.bodyText}>Sign in to ask follow-up questions with citations tied to bills and legislators.</Text>
          <PrimaryButton label="Use Demo Sign-In" onPress={signInDemo} />
        </Card>
      </ScreenView>
    );
  }

  return (
    <ScreenView
      title="Grounded Chat"
      subtitle="Use AI when you want more depth than the briefing page, not as a replacement for the official record."
    >
      <Card>
        <Text style={styles.sectionTitle}>Suggested starting points</Text>
        <View style={styles.promptRow}>
          {[
            'What are the biggest bills moving this week?',
            'Explain SF 1832 in plain language.',
            'How do I find my legislator?',
          ].map((prompt) => (
            <Chip
              key={prompt}
              label={prompt}
              onPress={() =>
                navigation.navigate('ChatSession', {
                  title: 'General civic question',
                  seedPrompt: prompt,
                  subjectType: 'general',
                })
              }
            />
          ))}
        </View>
      </Card>
      <View style={styles.stack}>
        {(sessionsQuery.data ?? []).map((session) => (
          <Card key={session.id}>
            <Text style={styles.sectionTitle}>{session.title}</Text>
            <Text style={styles.bodyText}>{session.subjectLabel ?? 'General civic question'}</Text>
            <Text style={styles.bodyText}>Updated {session.updatedAt.slice(0, 10)}</Text>
            <PrimaryButton
              label="Open Conversation"
              tone="secondary"
              onPress={() => navigation.navigate('ChatSession', { sessionId: session.id })}
            />
          </Card>
        ))}
      </View>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.md,
  },
  promptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
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
