import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { Card } from '../components/Card';
import { ScreenView } from '../components/ScreenView';
import { LegislatorChatCitation } from '../data/api';
import {
  useCreateLegislatorChatSession,
  useLegislatorChatMessages,
  useSendLegislatorChatMessage,
} from '../hooks/useAppQueries';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { theme } from '../theme/tokens';
import { fieldFocusRing } from '../theme/fieldFocus';

type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: LegislatorChatCitation[];
  wasRefusal?: boolean;
  isTyping?: boolean;
};

const webInputFocusReset = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null;

// The persona is an AI simulation grounded only in the record; this framing is
// fixed UI copy (grounded-answers.md rule 3), not model output.
const AI_DISCLOSURE =
  'AI simulation — not the real person. Answers are grounded only in this legislator’s public sponsorships, votes, and bill summaries.';
const INTRO_MESSAGE =
  'I’m an AI simulation of this Minnesota legislator. Ask me anything — my answers are grounded in the public record: sponsorships, votes, and bill summaries.';

export function LegislatorChatScreen() {
  const { width, height } = useWindowDimensions();
  const [draft, setDraft] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [pendingUserMessage, setPendingUserMessage] = useState<DisplayMessage | null>(null);
  const startRef = useRef(false);

  const createSession = useCreateLegislatorChatSession();
  const messagesQuery = useLegislatorChatMessages(sessionId);
  const sendMessage = useSendLegislatorChatMessage();
  const createSessionMutate = createSession.mutateAsync;

  // Open one session per visit. The backend pins the demo legislator on create.
  useEffect(() => {
    if (startRef.current) {
      return;
    }
    startRef.current = true;

    let cancelled = false;
    void createSessionMutate()
      .then((session) => {
        if (!cancelled) {
          setSessionId(session.id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          startRef.current = false;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createSessionMutate]);

  const startupError = createSession.error instanceof Error ? createSession.error.message : null;
  const sendError = sendMessage.error instanceof Error ? sendMessage.error.message : null;

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const messages: DisplayMessage[] = (messagesQuery.data ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      citations: message.citations,
      wasRefusal: message.wasRefusal,
    }));

    if (!pendingUserMessage) {
      return messages;
    }

    return [
      ...messages,
      pendingUserMessage,
      { id: 'typing-assistant', role: 'assistant', text: '', isTyping: true },
    ];
  }, [messagesQuery.data, pendingUserMessage]);

  const androidKeyboardOffset = Platform.OS === 'android' ? keyboardHeight : 0;
  const chatShellMinHeight = Math.max(height - 320 - androidKeyboardOffset, 260);
  const isDesktop = width >= 980;

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function submitDraft() {
    const text = draft.trim();
    if (!sessionId || !text || sendMessage.isPending) {
      return;
    }

    setPendingUserMessage({
      id: `pending-user-${Date.now()}`,
      role: 'user',
      text,
    });
    setDraft('');
    sendMessage.mutate(
      { sessionId, content: text },
      {
        onSettled: () => {
          setPendingUserMessage(null);
        },
      },
    );
  }

  const composerDisabled = !sessionId || sendMessage.isPending;

  return (
    <ScreenView
      title="Legislator Chat"
      subtitle="AI SIMULATION · Internal demo"
      scrollToEndKey={displayMessages.map((message) => message.id).join(':')}
    >
      <Card style={styles.disclosureCard}>
        <View style={styles.disclosureHeader}>
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>AI Simulation</Text>
          </View>
        </View>
        <Text style={styles.disclosureText}>{AI_DISCLOSURE}</Text>
      </Card>

      {!sessionId ? (
        <Card>
          <Text style={styles.bodyText}>{startupError ?? 'Starting the conversation…'}</Text>
        </Card>
      ) : (
        <View style={[styles.chatShell, { minHeight: chatShellMinHeight }]}>
          <View style={[styles.stack, styles.messageStack]}>
            {displayMessages.length === 0 ? (
              <View style={[styles.messageRow, styles.assistantRow]}>
                <View style={[styles.bubble, styles.assistantBubble]}>
                  <Text style={[styles.messageRole, styles.assistantRole]}>Simulation</Text>
                  <Text style={[styles.bodyText, styles.assistantText]}>{INTRO_MESSAGE}</Text>
                </View>
              </View>
            ) : null}

            {displayMessages.map((message) => {
              const isAssistant = message.role === 'assistant';
              const citations = message.citations ?? [];

              return (
                <View
                  key={message.id}
                  style={[styles.messageRow, isAssistant ? styles.assistantRow : styles.userRow]}
                >
                  <View
                    style={[
                      styles.bubble,
                      isAssistant ? styles.assistantBubble : styles.userBubble,
                      message.wasRefusal ? styles.refusalBubble : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageRole,
                        isAssistant ? styles.assistantRole : styles.userRole,
                      ]}
                    >
                      {isAssistant ? 'Simulation' : 'You'}
                    </Text>
                    {message.isTyping ? (
                      <ThinkingIndicator />
                    ) : (
                      <Text
                        style={[
                          styles.bodyText,
                          isAssistant ? styles.assistantText : styles.userText,
                        ]}
                      >
                        {message.text}
                      </Text>
                    )}
                    {citations.length > 0 ? (
                      <View style={styles.citationPillRow}>
                        {citations.map((citation) => (
                          <CitationPill key={citation.id} citation={citation} />
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
            <View style={[styles.inputBar, ...fieldFocusRing(composerFocused)]}>
              <TextInput
                accessibilityLabel="Chat message"
                placeholder="Ask about a bill this legislator sponsored or voted on"
                placeholderTextColor={theme.colors.mutedInk}
                cursorColor={theme.colors.ink}
                selectionColor={theme.colors.ink}
                style={[styles.input, webInputFocusReset]}
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onKeyPress={(event) => {
                  const nativeEvent = event.nativeEvent as { key?: string; shiftKey?: boolean };
                  if (
                    Platform.OS === 'web' &&
                    nativeEvent.key === 'Enter' &&
                    !nativeEvent.shiftKey
                  ) {
                    (event as any).preventDefault?.();
                    submitDraft();
                  }
                }}
                blurOnSubmit={false}
                editable={!composerDisabled}
                multiline
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={composerDisabled}
                style={[styles.sendButton, composerDisabled ? styles.sendButtonDisabled : null]}
                onPress={submitDraft}
              >
                <Text style={styles.sendButtonText}>
                  {sendMessage.isPending ? 'Sending' : 'Send'}
                </Text>
              </Pressable>
            </View>
            {!isDesktop ? null : (
              <Text style={styles.hintText}>Press Enter to send · Shift+Enter for a new line</Text>
            )}
          </View>
        </View>
      )}
    </ScreenView>
  );
}

function CitationPill({ citation }: { citation: LegislatorChatCitation }) {
  const hasUrl = Boolean(citation.url);

  return (
    <Pressable
      accessibilityRole={hasUrl ? 'link' : 'text'}
      accessibilityLabel={hasUrl ? `Open official source ${citation.billKey}` : citation.billKey}
      disabled={!hasUrl}
      onPress={() => {
        if (citation.url) {
          void Linking.openURL(citation.url);
        }
      }}
      style={({ pressed }) => [
        styles.citationPill,
        pressed && hasUrl ? styles.citationPillPressed : null,
      ]}
    >
      <Text style={styles.citationPillText} numberOfLines={1}>
        {citation.billKey}
      </Text>
    </Pressable>
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
      }),
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
    <View style={styles.thinkingRow} accessibilityLabel="The simulation is thinking">
      <Text style={[styles.bodyText, styles.assistantText]}>Working through the record</Text>
      <View style={styles.typingDots}>{dots}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  disclosureCard: {
    gap: theme.spacing.sm,
    borderColor: theme.colors.purple.border,
    backgroundColor: theme.colors.purple.tint,
  },
  disclosureHeader: {
    flexDirection: 'row',
  },
  aiBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.purple.base,
    borderRadius: theme.radii.badge,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  aiBadgeText: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  disclosureText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  chatShell: {
    width: '100%',
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
  refusalBubble: {
    borderStyle: 'dashed',
    borderColor: theme.colors.borders.strong,
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
  citationPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  citationPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.tint.border,
    backgroundColor: theme.colors.tint.t150,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    maxWidth: '100%',
  },
  citationPillPressed: {
    opacity: 0.72,
  },
  citationPillText: {
    color: theme.colors.text.green,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '600',
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
  sendButton: {
    minWidth: 104,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  hintText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 12,
  },
});
