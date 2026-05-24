import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
import { ScreenView } from '../components/ScreenView';
import { Citation } from '../data/types';
import {
  useChatSession,
  useCreateChatSession,
  useSendChatMessage,
} from '../hooks/useAppQueries';
import { useReducedMotion } from '../hooks/useReducedMotion';
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
  citations?: Citation[];
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
  const { width, height } = useWindowDimensions();
  const routeParams = route.params ?? {};
  const params = useMemo<Partial<ChatParams>>(() => {
    if (routeParams.sessionId || hasBillChatSubject(routeParams)) {
      return routeParams;
    }
    return readPendingBillChat() ?? routeParams;
  }, [routeParams]);
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState(params.sessionId);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
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
        text: '',
        createdAt: new Date().toISOString(),
        isTyping: true,
      },
    ];
  }, [pendingUserMessage, session?.messages]);

  const citationIds = useMemo(
    () => new Set(displayMessages.flatMap((message) => (message.citations ?? []).map((citation) => citation.id))),
    [displayMessages]
  );
  const showCitationRail = width >= 980;
  const chatShellMinHeight = Math.max(height - 300, 460);

  useEffect(() => {
    if (selectedCitation && !citationIds.has(selectedCitation.id)) {
      setSelectedCitation(null);
    }
  }, [citationIds, selectedCitation]);

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
          <View style={[styles.chatShell, { minHeight: chatShellMinHeight }]}>
            <View style={[styles.chatLayout, !showCitationRail ? styles.chatLayoutStacked : null]}>
              <View style={styles.chatColumn}>
                <View style={[styles.stack, styles.messageStack]}>
                  {displayMessages.map((message) => {
                    const isAssistant = message.role === 'assistant';
                    const citations = message.citations ?? [];

                    return (
                      <View
                        key={message.id}
                        style={[styles.messageRow, isAssistant ? styles.assistantRow : styles.userRow]}
                      >
                        <View style={[styles.bubble, isAssistant ? styles.assistantBubble : styles.userBubble]}>
                          <Text style={[styles.messageRole, isAssistant ? styles.assistantRole : styles.userRole]}>
                            {isAssistant ? 'Alethical' : 'You'}
                          </Text>
                          {message.isTyping ? (
                            <ThinkingIndicator />
                          ) : (
                            <Text style={[styles.bodyText, isAssistant ? styles.assistantText : styles.userText]}>
                              {message.text}
                            </Text>
                          )}
                          {citations.length > 0 ? (
                            <View style={styles.citationPillRow}>
                              {citations.map((citation, index) => {
                                const selected = selectedCitation?.id === citation.id;
                                return (
                                  <Pressable
                                    key={citation.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Show citation ${index + 1}`}
                                    onPress={() => setSelectedCitation(citation)}
                                    style={({ pressed }) => [
                                      styles.citationToggle,
                                      selected ? styles.citationToggleOpen : null,
                                      pressed ? styles.citationTogglePressed : null,
                                    ]}
                                  >
                                    <Text style={styles.citationToggleText}>
                                      [{index + 1}] {citation.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
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
              </View>
              {selectedCitation ? (
                <CitationSidebar
                  citation={selectedCitation}
                  compact={!showCitationRail}
                  onClose={() => setSelectedCitation(null)}
                />
              ) : null}
            </View>
          </View>
        </>
      )}
    </ScreenView>
  );
}

function ThinkingIndicator() {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 950,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  const dots = [0, 1, 2].map((index) => {
    const opacity = reducedMotion
      ? 1
      : progress.interpolate({
          inputRange: [0, 0.25 + index * 0.12, 0.55 + index * 0.12, 1],
          outputRange: [0.28, 1, 0.28, 0.28],
        });
    const translateY = reducedMotion
      ? 0
      : progress.interpolate({
          inputRange: [0, 0.25 + index * 0.12, 0.55 + index * 0.12, 1],
          outputRange: [0, -3, 0, 0],
        });
    return (
      <Animated.View
        key={index}
        style={[styles.typingDot, { opacity, transform: [{ translateY }] }]}
      />
    );
  });

  return (
    <View style={styles.thinkingRow} accessibilityLabel="Alethical is thinking">
      <Text style={[styles.bodyText, styles.assistantText]}>Working through sources</Text>
      <View style={styles.typingDots}>{dots}</View>
    </View>
  );
}

function CitationSidebar({
  citation,
  compact,
  onClose,
}: {
  citation: Citation;
  compact: boolean;
  onClose: () => void;
}) {
  const fullText = citation.fullText?.trim() || citation.excerpt;

  return (
    <View style={[styles.citationSidebar, compact ? styles.citationSidebarCompact : null]}>
      <View style={styles.citationSidebarHeader}>
        <View style={styles.citationSidebarTitleGroup}>
          <Text style={styles.citationKicker}>Citation</Text>
          <Text style={styles.citationSidebarTitle}>{citation.label}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close citation"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed ? styles.citationTogglePressed : null]}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.citationTextPanel} contentContainerStyle={styles.citationTextPanelContent}>
        <HighlightedCitationText text={fullText} highlight={citation.highlightText || citation.excerpt} />
      </ScrollView>
      {citation.url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open official source"
          onPress={() => void Linking.openURL(citation.url)}
          style={({ pressed }) => [styles.sourceLink, pressed ? styles.citationTogglePressed : null]}
        >
          <Text style={styles.sourceLinkText}>Open official source</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function HighlightedCitationText({ text, highlight }: { text: string; highlight: string }) {
  const range = highlightedRange(text, highlight);
  if (!range) {
    return (
      <Text style={styles.citationText}>
        <Text style={styles.citationHighlight}>{highlight}</Text>
        {'\n\n'}
        {text}
      </Text>
    );
  }

  return (
    <Text style={styles.citationText}>
      {text.slice(0, range.start)}
      <Text style={styles.citationHighlight}>{text.slice(range.start, range.end)}</Text>
      {text.slice(range.end)}
    </Text>
  );
}

function highlightedRange(text: string, highlight: string) {
  const target = normalizeSearchText(highlight);
  if (target.length < 8) {
    return null;
  }

  const indexMap: number[] = [];
  let normalized = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) {
      continue;
    }
    normalized += char.toLowerCase();
    indexMap.push(index);
  }

  const start = normalized.indexOf(target);
  if (start < 0) {
    return null;
  }

  return {
    start: indexMap[start],
    end: indexMap[start + target.length - 1] + 1,
  };
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

const styles = StyleSheet.create({
  chatShell: {
    width: '100%',
  },
  chatLayout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.lg,
  },
  chatLayoutStacked: {
    flexDirection: 'column',
  },
  chatColumn: {
    flex: 1,
    minWidth: 0,
  },
  stack: {
    gap: theme.spacing.lg,
  },
  messageStack: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: theme.spacing.md,
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
    maxWidth: 820,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  assistantBubble: {
    width: '100%',
    backgroundColor: theme.colors.surfaceAlt,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
  },
  userBubble: {
    minWidth: 180,
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
    maxWidth: '100%',
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
  citationPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  citationText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  citationHighlight: {
    backgroundColor: theme.colors.accentSoft,
    color: theme.colors.ink,
  },
  citationSidebar: {
    width: 360,
    maxWidth: '100%',
    alignSelf: 'stretch',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  citationSidebarCompact: {
    width: '100%',
  },
  citationSidebarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  citationSidebarTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  citationKicker: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  citationSidebarTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  citationTextPanel: {
    maxHeight: 520,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  citationTextPanelContent: {
    padding: theme.spacing.sm,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surfaceAlt,
  },
  closeButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  sourceLink: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  sourceLinkText: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  typingDots: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    alignItems: 'center',
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
