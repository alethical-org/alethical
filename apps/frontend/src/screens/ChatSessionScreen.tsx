import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
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
type ChatParams = RootStackParamList['ChatSession'];
type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt?: string;
  citations?: Array<{ id: string; label: string; excerpt: string; url: string }>;
  isTyping?: boolean;
};

const webInputFocusReset = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null;
const pendingBillChatStorageKey = 'alethical.pendingBillChat';

function hasBillChatSubject(params: Partial<ChatParams>) {
  return params.subjectType === 'bill' && Boolean(params.subjectId);
}

function storePendingBillChat(params: ChatParams) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !hasBillChatSubject(params)) {
    return;
  }

  window.sessionStorage.setItem(pendingBillChatStorageKey, JSON.stringify(params));
}

function readPendingBillChat(): ChatParams | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  const raw = window.sessionStorage.getItem(pendingBillChatStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ChatParams;
    return hasBillChatSubject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingBillChat() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(pendingBillChatStorageKey);
  }
}

function pendingBillChatPath(params: RootStackParamList['ChatSession']) {
  if (params.sessionId || params.subjectType !== 'bill' || !params.subjectId) {
    return undefined;
  }

  const searchParams = new URLSearchParams();
  searchParams.set('subjectType', 'bill');
  searchParams.set('subjectId', params.subjectId);
  if (params.title) {
    searchParams.set('title', params.title);
  }
  if (params.seedPrompt) {
    searchParams.set('prompt', params.seedPrompt);
  }
  if (params.subjectLabel) {
    searchParams.set('subjectLabel', params.subjectLabel);
  }

  return `/chat/new?${searchParams.toString()}`;
}

function messageRoleRank(role: DisplayMessage['role']) {
  return role === 'user' ? 0 : 1;
}

export function ChatSessionScreen({ route }: Props) {
  const { isSignedIn, user } = useAuth();
  const routeParams = route.params ?? {};
  const params = useMemo<Partial<ChatParams>>(() => {
    if (routeParams.sessionId || hasBillChatSubject(routeParams)) {
      return routeParams;
    }
    return readPendingBillChat() ?? routeParams;
  }, [routeParams]);
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState(params.sessionId);
  const [expandedCitationMessages, setExpandedCitationMessages] = useState<Record<string, boolean>>({});
  const [pendingUserMessage, setPendingUserMessage] = useState<DisplayMessage | null>(null);
  const pendingSessionKeyRef = useRef<string | null>(null);

  const createSession = useCreateChatSession(user?.id);
  const sendMessage = useSendChatMessage(user?.id);
  const sessionQuery = useChatSession(user?.id, sessionId);
  const createChatSession = createSession.mutateAsync;

  useEffect(() => {
    if (hasBillChatSubject(params)) {
      storePendingBillChat(params as ChatParams);
    }
  }, [params]);

  useEffect(() => {
    setSessionId(params.sessionId);
    if (params.sessionId) {
      pendingSessionKeyRef.current = null;
    }
  }, [params.sessionId]);

  useEffect(() => {
    if (!isSignedIn || sessionId || params.subjectType !== 'bill' || !params.subjectId || !params.title) {
      return;
    }

    const pendingSessionKey = [
      params.title,
      params.subjectType,
      params.subjectId ?? '',
    ].join('::');

    if (pendingSessionKeyRef.current === pendingSessionKey) {
      return;
    }
    pendingSessionKeyRef.current = pendingSessionKey;

    let cancelled = false;

    void createChatSession({
      title: params.title,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectLabel: params.subjectLabel,
      seedPrompt: params.seedPrompt,
    })
      .then((session) => {
        if (!cancelled) {
          clearPendingBillChat();
          setSessionId(session.id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          pendingSessionKeyRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createChatSession, isSignedIn, params.seedPrompt, params.subjectId, params.subjectLabel, params.subjectType, params.title, sessionId]);

  const session = sessionQuery.data;
  const startupError = createSession.error instanceof Error ? createSession.error.message : null;
  const sendError = sendMessage.error instanceof Error ? sendMessage.error.message : null;
  const loadError = sessionQuery.error instanceof Error ? sessionQuery.error.message : null;
  const canStartBillChat = Boolean(sessionId || (params.subjectType === 'bill' && params.subjectId && params.title));
  const signInReturnTo = pendingBillChatPath(params);
  const title = useMemo(() => {
    if (session?.title) {
      return session.title;
    }
    if (params.title) {
      return params.title;
    }
    return 'Conversation';
  }, [params.title, session?.title]);
  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const messages: DisplayMessage[] = [...(session?.messages ?? [])].sort((left, right) => {
      const leftTime = left.createdAt ?? '';
      const rightTime = right.createdAt ?? '';
      if (leftTime !== rightTime) {
        return leftTime.localeCompare(rightTime);
      }
      return messageRoleRank(left.role) - messageRoleRank(right.role);
    });
    if (!pendingUserMessage) {
      return messages;
    }

    return [
      ...messages,
      pendingUserMessage,
      {
        id: 'typing-assistant',
        role: 'assistant',
        text: 'Thinking...',
        createdAt: new Date().toISOString(),
        isTyping: true,
      },
    ];
  }, [pendingUserMessage, session?.messages]);

  function toggleMessageCitations(messageId: string) {
    setExpandedCitationMessages((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }

  function submitDraft() {
    const text = draft.trim();
    if (!sessionId || !text || sendMessage.isPending) {
      return;
    }

    setPendingUserMessage({
      id: `pending-user-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    });
    setDraft('');
    sendMessage.mutate(
      { sessionId, text },
      {
        onSettled: () => {
          setPendingUserMessage(null);
        },
      }
    );
  }

  if (!isSignedIn) {
    return (
      <ScreenView title="Grounded Chat" subtitle="Chat is available once you sign in.">
        <AuthRequiredCard
          message="Sign in to save conversations and ask follow-up questions grounded in legislative data."
          returnTo={signInReturnTo}
        />
      </ScreenView>
    );
  }

  return (
    <ScreenView
      title={title}
      subtitle={session?.subjectLabel ?? params.subjectLabel ?? 'Grounded answers with citations when available.'}
      scrollToEndKey={displayMessages.map((message) => message.id).join(':')}
    >
      {!canStartBillChat ? (
        <Card>
          <Text style={styles.bodyText}>Start a chat from a bill page so retrieval stays scoped to that bill.</Text>
        </Card>
      ) : !session ? (
        <Card>
          <Text style={styles.bodyText}>
            {startupError ?? loadError ?? 'Preparing your conversation...'}
          </Text>
        </Card>
      ) : (
        <>
          <View style={styles.stack}>
            {displayMessages.map((message) => {
              const isAssistant = message.role === 'assistant';
              const citations = message.citations ?? [];
              const citationsExpanded = Boolean(expandedCitationMessages[message.id]);

              return (
                <View
                  key={message.id}
                  style={[styles.messageRow, isAssistant ? styles.assistantRow : styles.userRow]}
                >
                  <View style={[styles.bubble, isAssistant ? styles.assistantBubble : styles.userBubble]}>
                    <Text style={[styles.messageRole, isAssistant ? styles.assistantRole : styles.userRole]}>
                      {isAssistant ? 'Alethical' : 'You'}
                    </Text>
                    <Text style={[styles.bodyText, isAssistant ? styles.assistantText : styles.userText]}>
                      {message.text}
                    </Text>
                    {message.isTyping ? (
                      <View style={styles.typingDots} accessibilityLabel="Alethical is typing">
                        <View style={styles.typingDot} />
                        <View style={styles.typingDot} />
                        <View style={styles.typingDot} />
                      </View>
                    ) : null}
                    {citations.length > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={citationsExpanded ? 'Hide citations' : 'Show citations'}
                        onPress={() => toggleMessageCitations(message.id)}
                        style={({ pressed }) => [
                          styles.citationToggle,
                          citationsExpanded ? styles.citationToggleOpen : null,
                          pressed ? styles.citationTogglePressed : null,
                        ]}
                      >
                        <Text style={styles.citationToggleText}>
                          {citationsExpanded ? 'Hide citations' : `Citations (${citations.length})`}
                        </Text>
                      </Pressable>
                    ) : null}
                    {citationsExpanded ? (
                      <View style={styles.citationStack}>
                        {citations.map((citation) => (
                          <View key={citation.id} style={styles.citationBlock}>
                            <Text style={styles.citationLabel}>{citation.label}</Text>
                            <Text style={styles.citationText}>{citation.excerpt}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          <View style={styles.composer}>
            {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
            <View style={styles.inputBar}>
              <TextInput
                accessibilityLabel="Chat message"
                placeholder="Ask a question about this bill"
                placeholderTextColor={theme.colors.mutedInk}
                style={[styles.input, webInputFocusReset]}
                value={draft}
                onChangeText={setDraft}
                onKeyPress={(event) => {
                  const nativeEvent = event.nativeEvent as { key?: string; shiftKey?: boolean };
                  if (Platform.OS === 'web' && nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
                    (event as any).preventDefault?.();
                    submitDraft();
                  }
                }}
                blurOnSubmit={false}
                multiline
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                style={styles.sendButton}
                onPress={submitDraft}
              >
                <Text style={styles.sendButtonText}>{sendMessage.isPending ? 'Sending' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.lg,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  bubble: {
    width: '100%',
    maxWidth: 820,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surfaceAlt,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
  },
  userBubble: {
    maxWidth: 700,
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
  },
  messageRole: {
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  assistantRole: {
    color: theme.colors.accent,
  },
  userRole: {
    color: theme.colors.white,
    opacity: 0.78,
    textAlign: 'right',
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  assistantText: {
    color: theme.colors.ink,
  },
  userText: {
    color: theme.colors.white,
  },
  errorText: {
    color: theme.colors.danger,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  citationToggle: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  citationToggleOpen: {
    backgroundColor: theme.colors.accentSoft,
  },
  citationTogglePressed: {
    opacity: 0.75,
  },
  citationToggleText: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  citationStack: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  citationBlock: {
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  citationText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  typingDots: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.mutedInk,
  },
  composer: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: 28,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.xs,
    paddingVertical: 4,
  },
  sendButton: {
    minWidth: 104,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  sendButtonText: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
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
    flex: 1,
    minHeight: 42,
    maxHeight: 128,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
