import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import {
  useChatSession,
  useCreateChatSession,
  useSendChatMessage,
} from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSession'>;

export function ChatSessionScreen({ route }: Props) {
  const { isSignedIn, user } = useAuth();
  const params = route.params ?? {};
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState(params.sessionId);
  const seededConversationKeyRef = useRef<string | null>(null);

  const createSession = useCreateChatSession(user?.id);
  const sendMessage = useSendChatMessage(user?.id);
  const sessionQuery = useChatSession(user?.id, sessionId);

  useEffect(() => {
    setSessionId(params.sessionId);
    if (params.sessionId) {
      seededConversationKeyRef.current = null;
    }
  }, [params.sessionId]);

  useEffect(() => {
    if (!isSignedIn || sessionId || !params.seedPrompt || !params.subjectType || !params.title) {
      return;
    }

    const seededConversationKey = [
      params.title,
      params.subjectType,
      params.subjectId ?? '',
      params.seedPrompt,
    ].join('::');

    if (seededConversationKeyRef.current === seededConversationKey) {
      return;
    }
    seededConversationKeyRef.current = seededConversationKey;

    let cancelled = false;

    void createSession
      .mutateAsync({
        title: params.title,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectLabel: params.subjectLabel,
        seedPrompt: params.seedPrompt,
      })
      .then((session) => {
        if (!cancelled) {
          setSessionId(session.id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          seededConversationKeyRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createSession, isSignedIn, params.seedPrompt, params.subjectId, params.subjectLabel, params.subjectType, params.title, sessionId]);

  const session = sessionQuery.data;
  const title = useMemo(() => {
    if (session?.title) {
      return session.title;
    }
    if (params.title) {
      return params.title;
    }
    return 'Conversation';
  }, [params.title, session?.title]);

  if (!isSignedIn) {
    return (
      <ScreenView title="Grounded Chat" subtitle="Chat is available once you sign in.">
        <AuthRequiredCard message="Sign in to save conversations and ask follow-up questions grounded in legislative data." />
      </ScreenView>
    );
  }

  return (
    <ScreenView title={title} subtitle={session?.subjectLabel ?? params.subjectLabel ?? 'Grounded answers with citations when available.'}>
      {!session ? (
        <Card>
          <Text style={styles.bodyText}>Preparing your conversation...</Text>
        </Card>
      ) : (
        <>
          <View style={styles.stack}>
            {session.messages.map((message) => (
              <Card
                key={message.id}
                style={message.role === 'assistant' ? styles.assistantCard : styles.userCard}
              >
                <Text style={styles.messageRole}>{message.role === 'assistant' ? 'Alethical' : 'You'}</Text>
                <Text style={styles.bodyText}>{message.text}</Text>
                {message.citations?.map((citation) => (
                  <View key={citation.id} style={styles.citationBlock}>
                    <Text style={styles.citationLabel}>{citation.label}</Text>
                    <Text style={styles.bodyText}>{citation.excerpt}</Text>
                  </View>
                ))}
              </Card>
            ))}
          </View>
          <Card>
            <TextInput
              accessibilityLabel="Chat message"
              placeholder="Ask a follow-up question"
              placeholderTextColor={theme.colors.mutedInk}
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <PrimaryButton
              label="Send"
              onPress={() => {
                if (!sessionId || !draft.trim()) {
                  return;
                }

                sendMessage.mutate({ sessionId, text: draft.trim() });
                setDraft('');
              }}
            />
          </Card>
        </>
      )}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.md,
  },
  assistantCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
  },
  userCard: {
    backgroundColor: theme.colors.surface,
  },
  messageRole: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  citationBlock: {
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  citationLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  input: {
    minHeight: 96,
    borderRadius: theme.radii.md,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.md,
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 15,
    textAlignVertical: 'top',
  },
});
