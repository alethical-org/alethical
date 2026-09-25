import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme as t } from '../../theme/tokens';

import { EmailButton, EmailNotice, emailColors } from '../../components/email/EmailControls';
import { ApiError } from '../../data/api';
import {
  inspectEmailUnsubscribeToken,
  unsubscribeFromEmail,
  type EmailUnsubscribeAction,
} from '../../data/emailSubscriptions';
import { useResponsive } from '../../hooks/useResponsive';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import type { RootScreenProps } from '../../navigation/types';

function tokenFromFragment(): string | null {
  if (typeof window === 'undefined') return null;
  const fragment = window.location.hash.replace(/^#/, '');
  const token = new URLSearchParams(fragment).get('unsubscribe');
  return token || null;
}

type Phase = 'checking' | 'ready' | 'busy' | 'invalid' | 'load-error' | 'uncertain' | 'success';

function ContactUsButton() {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void Linking.openURL('mailto:ask@alethical.com')}
      onHoverIn={() => {
        if (
          Platform.OS === 'web' &&
          window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
        )
          setHovered(true);
      }}
      onHoverOut={() => setHovered(false)}
      style={[styles.contactButton, hovered && styles.contactButtonHover]}
    >
      <Text style={styles.contactTitle}>Contact us</Text>
      <Text style={styles.contactAddress}>ask@alethical.com</Text>
    </Pressable>
  );
}

export function UnsubscribeScreen({ navigation }: RootScreenProps<'Unsubscribe'>) {
  const { isMobile } = useResponsive();
  const [token] = useState(tokenFromFragment);
  const [phase, setPhase] = useState<Phase>('checking');
  const [action, setAction] = useState<EmailUnsubscribeAction | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  const inspect = async () => {
    if (!token) {
      setPhase('invalid');
      return;
    }
    const current = ++generation.current;
    setPhase('checking');
    try {
      const valid = await inspectEmailUnsubscribeToken(token);
      if (generation.current === current) setPhase(valid ? 'ready' : 'invalid');
    } catch (cause) {
      if (generation.current === current)
        setPhase(cause instanceof ApiError && cause.status === 404 ? 'invalid' : 'load-error');
    }
  };

  useEffect(() => {
    if (token && typeof window !== 'undefined' && window.location.hash) {
      // Keep the bearer link out of screenshots and later navigation.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    void inspect();
    return () => {
      generation.current += 1;
    };
  }, [token]);

  const stop = async (choice: EmailUnsubscribeAction) => {
    if (!token || busy.current) return;
    busy.current = true;
    setAction(choice);
    setPhase('busy');
    try {
      const done = await unsubscribeFromEmail(token, choice);
      setPhase(done ? 'success' : 'uncertain');
    } catch (cause) {
      setPhase(cause instanceof ApiError && cause.status === 404 ? 'invalid' : 'uncertain');
    } finally {
      busy.current = false;
    }
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={styles.main}>
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <Text accessibilityRole="header" aria-level={1} style={styles.title}>
              {phase === 'success' ? 'You’re unsubscribed' : 'Unsubscribe from Unconcealed'}
            </Text>
            <Text style={styles.subtitle}>Minnesota campaign money and lobbying research</Text>
            {phase === 'checking' ? (
              <Text aria-live="polite" style={styles.body}>
                Opening your unsubscribe request…
              </Text>
            ) : null}
            {phase === 'ready' || phase === 'busy' ? (
              <>
                <Text style={styles.body}>
                  Choose which emails you want to stop. Your Alethical account stays open.
                </Text>
                <View style={styles.actions}>
                  <EmailButton
                    label={
                      phase === 'busy' && action === 'research'
                        ? 'Unsubscribing…'
                        : 'Unsubscribe from Unconcealed'
                    }
                    onPress={() => void stop('research')}
                    busy={phase === 'busy'}
                    fullWidth
                    minHeight={isMobile ? 54 : 52}
                  />
                  <EmailButton
                    label={
                      phase === 'busy' && action === 'all'
                        ? 'Unsubscribing…'
                        : 'Stop all research and feature emails'
                    }
                    kind="outline"
                    onPress={() => void stop('all')}
                    busy={phase === 'busy'}
                    fullWidth
                    minHeight={isMobile ? 54 : 50}
                  />
                </View>
              </>
            ) : null}
            {phase === 'success' ? (
              <EmailNotice kind="success">
                {action === 'all'
                  ? 'Research and feature emails have stopped.'
                  : 'Unconcealed research emails have stopped.'}{' '}
                Your account stays open. Account security emails continue.
              </EmailNotice>
            ) : null}
            {phase === 'invalid' || phase === 'load-error' ? (
              <View style={styles.failure}>
                <EmailNotice kind="error">We couldn’t open your unsubscribe request</EmailNotice>
                <Text style={styles.body}>
                  {phase === 'invalid'
                    ? 'The link may be damaged. Try opening it from the email again, or contact us.'
                    : 'Please try again, or contact us.'}
                </Text>
                <EmailButton label="Try again" onPress={() => void inspect()} fullWidth />
                <ContactUsButton />
              </View>
            ) : null}
            {phase === 'uncertain' ? (
              <View style={styles.failure}>
                <EmailNotice kind="uncertain">
                  We couldn’t confirm whether you were unsubscribed
                </EmailNotice>
                <Text style={styles.body}>Try again, or contact us.</Text>
                <EmailButton
                  label="Try again"
                  fullWidth
                  onPress={() => {
                    if (action) void stop(action);
                  }}
                />
                <ContactUsButton />
              </View>
            ) : null}
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { width: '100%', alignItems: 'center', paddingTop: 66, paddingBottom: 90 },
  card: {
    width: '100%',
    maxWidth: 520,
    minHeight: 372,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe3e6',
    borderRadius: 18,
    padding: 32,
    ...(Platform.OS === 'web' ? { boxShadow: '0 16px 44px rgba(17,21,15,0.11)' } : null),
  },
  cardMobile: { padding: 22, minHeight: 372, borderRadius: 16 },
  title: {
    fontFamily: t.typography.title,
    fontWeight: t.fontWeights.heavy,
    fontSize: 27,
    lineHeight: 34,
    color: emailColors.ink,
  },
  subtitle: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 16.5,
    lineHeight: 24,
    marginTop: 8,
    color: '#4b524b',
  },
  body: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 15.5,
    lineHeight: 23,
    marginTop: 18,
    color: emailColors.muted,
  },
  actions: { marginTop: 28, gap: 12 },
  failure: { marginTop: 24, gap: 15 },
  contactButton: {
    minHeight: 56,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  contactButtonHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  contactTitle: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 16,
    color: emailColors.ink,
  },
  contactAddress: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.medium,
    fontSize: 14,
    color: emailColors.muted,
    marginTop: 2,
  },
});
