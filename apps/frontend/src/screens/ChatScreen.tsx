import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MessageSquareText } from 'lucide-react-native';

import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
import { ScreenView } from '../components/ScreenView';
import { useChatSessions } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Chat'>;

export function ChatScreen({ navigation }: Props) {
  const { isSignedIn, user } = useAuth();
  const chatSessionsQuery = useChatSessions(user?.id);

  if (!isSignedIn) {
    return (
      <ScreenView title="Chat" subtitle="Ask grounded questions after choosing a bill.">
        <AuthRequiredCard message="Sign in to keep chat history and ask follow-up questions with citations." />
      </ScreenView>
    );
  }

  const sessions = chatSessionsQuery.data ?? [];

  return (
    <ScreenView
      title="Chat"
      subtitle="Saved conversations scoped to bills and grounded source material."
    >
      <Card>
        <View style={styles.promptHeader}>
          <View style={styles.promptIcon}>
            <MessageSquareText color={theme.colors.ink} size={22} strokeWidth={2.1} />
          </View>
          <View style={styles.promptCopy}>
            <Text style={styles.cardTitle}>Start from a bill</Text>
            <Text style={styles.bodyText}>
              Open any bill and use its suggested questions so retrieval stays tied to the official
              record.
            </Text>
          </View>
        </View>
      </Card>

      {chatSessionsQuery.isLoading ? (
        <Card>
          <Text style={styles.bodyText}>Loading chat sessions from the backend.</Text>
        </Card>
      ) : null}
      {chatSessionsQuery.error ? (
        <Card>
          <Text style={styles.bodyText}>
            {chatSessionsQuery.error instanceof Error
              ? chatSessionsQuery.error.message
              : 'Chat sessions could not be loaded.'}
          </Text>
        </Card>
      ) : null}
      {!chatSessionsQuery.isLoading && !chatSessionsQuery.error && sessions.length === 0 ? (
        <Card>
          <Text style={styles.bodyText}>
            No conversations yet. Search for a bill and start with a suggested question.
          </Text>
        </Card>
      ) : null}
      {!chatSessionsQuery.isLoading && !chatSessionsQuery.error && sessions.length > 0 ? (
        <View style={styles.stack}>
          {sessions.map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${session.title}`}
              onPress={() => navigation.navigate('ChatSession', { sessionId: session.id })}
              style={({ pressed }) => [styles.sessionRow, pressed && styles.pressed]}
            >
              <Text style={styles.sessionTitle}>{session.title}</Text>
              <Text style={styles.sessionMeta}>
                {session.subjectLabel ?? session.subjectId ?? 'General'} |{' '}
                {session.updatedAt.slice(0, 10)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  promptHeader: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignItems: 'center',
  },
  promptIcon: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  cardTitle: {
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
  stack: {
    gap: theme.spacing.sm,
  },
  sessionRow: {
    minHeight: 74,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  sessionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  sessionMeta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.78,
  },
});
