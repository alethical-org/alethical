import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { theme as t } from '../../theme/tokens';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  EmailButton,
  EmailCheckbox,
  EmailNotice,
  emailColors,
} from '../../components/email/EmailControls';
import { ApiError } from '../../data/api';
import {
  readEmailPreferences,
  saveEmailPreferences,
  type EmailPreferences,
  type EmailPreferenceSave,
} from '../../data/emailSubscriptions';
import { useResponsive } from '../../hooks/useResponsive';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import type { RootScreenProps } from '../../navigation/types';

type Phase =
  'loading' | 'load-error' | 'ready' | 'saving' | 'uncertain' | 'saved' | 'stale' | 'needs-email';

export function EmailPreferencesScreen({ navigation }: RootScreenProps<'EmailPreferences'>) {
  const { isMobile, isTablet } = useResponsive();
  const { isLoading, isSignedIn, accessToken, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const [phase, setPhase] = useState<Phase>('loading');
  const [record, setRecord] = useState<EmailPreferences | null>(null);
  const [research, setResearch] = useState(false);
  const [features, setFeatures] = useState(false);
  const [retry, setRetry] = useState<EmailPreferenceSave | null>(null);
  const onceSignIn = useRef(false);
  const generation = useRef(0);
  const saving = useRef<number | null>(null);
  const identity = user?.id ?? null;

  useEffect(() => {
    if (isLoading || isSignedIn || onceSignIn.current) return;
    onceSignIn.current = true;
    openSignIn({ intent: 'nav', returnTo: '/email-preferences' });
  }, [isLoading, isSignedIn, openSignIn]);

  const load = useCallback(async (token: string, id: string, current: number) => {
    setPhase('loading');
    try {
      const next = await readEmailPreferences(token);
      if (generation.current !== current || next.account_id !== id) return;
      setRecord(next);
      setResearch(next.research === true);
      setFeatures(next.features === true);
      setRetry(null);
      setPhase(next.email ? 'ready' : 'needs-email');
    } catch {
      if (generation.current === current) setPhase('load-error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      generation.current += 1;
      const current = generation.current;
      setRecord(null);
      if (accessToken && identity) void load(accessToken, identity, current);
      return () => {
        generation.current += 1;
      };
    }, [accessToken, identity, load]),
  );

  const submit = async (body: EmailPreferenceSave) => {
    if (!accessToken || !identity) return;
    const token = accessToken;
    const id = identity;
    const current = generation.current;
    if (saving.current === current) return;
    saving.current = current;
    setPhase('saving');
    try {
      const next = await saveEmailPreferences(token, body);
      if (generation.current !== current || next.account_id !== id) return;
      setRecord(next);
      setResearch(next.research === true);
      setFeatures(next.features === true);
      setRetry(null);
      const returnedRequestedChoice =
        (body.research === undefined || body.research === next.research) &&
        (body.features === undefined || body.features === next.features);
      setPhase(returnedRequestedChoice ? 'saved' : 'stale');
    } catch (cause) {
      if (generation.current !== current) return;
      if (cause instanceof ApiError && cause.status === 409) {
        setRetry(null);
        setPhase('stale');
        return;
      }
      if (cause instanceof ApiError && cause.status === 422) {
        setRetry(null);
        setPhase('needs-email');
        return;
      }
      setRetry(body);
      setPhase('uncertain');
    } finally {
      if (saving.current === current) saving.current = null;
    }
  };

  const save = () => {
    if (!record) return;
    const body: EmailPreferenceSave = {
      ...(research !== (record.research === true) ? { research } : {}),
      ...(features !== (record.features === true) ? { features } : {}),
      expected_version: record.version,
      expected_account_id: record.account_id,
      expected_email: record.email,
      idempotency_key: crypto.randomUUID(),
      source: 'preferences',
    };
    if (body.research === undefined && body.features === undefined) {
      setPhase('saved');
      return;
    }
    void submit(body);
  };

  const researchChanged = !!record && research !== (record.research === true);
  const featuresChanged = !!record && features !== (record.features === true);
  const newConsentWithoutEmail =
    !record?.email && ((researchChanged && research) || (featuresChanged && features));

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={[styles.main, isTablet && styles.tablet, isMobile && styles.mobile]}>
          <View style={styles.content}>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.heading, isMobile && styles.headingMobile]}
            >
              Email preferences
            </Text>
            {isSignedIn ? (
              <>
                <Text style={styles.sendLabel}>SEND TO</Text>
                <Text style={styles.email}>
                  {record?.email ??
                    (phase === 'needs-email' ? 'No confirmed account email' : (user?.email ?? ''))}
                </Text>
                {phase === 'loading' ? (
                  <Text aria-live="polite" style={styles.status}>
                    Loading email preferences…
                  </Text>
                ) : null}
                {phase === 'load-error' ? (
                  <View style={styles.loadFailure}>
                    <EmailNotice kind="error">We couldn’t load your email preferences</EmailNotice>
                    <EmailButton
                      label="Try again"
                      kind="outline"
                      onPress={() => {
                        if (accessToken && identity)
                          void load(accessToken, identity, generation.current);
                      }}
                    />
                  </View>
                ) : null}
                {record && !['loading', 'load-error'].includes(phase) ? (
                  <>
                    <View style={styles.choiceCard}>
                      <EmailCheckbox
                        label="Unconcealed research"
                        help="About Minnesota campaign money and lobbying"
                        value={research}
                        onChange={(next) => {
                          setResearch(next);
                          setRetry(null);
                          setPhase('ready');
                        }}
                        locked={phase === 'saving'}
                        mark={
                          researchChanged
                            ? phase === 'uncertain'
                              ? 'Not confirmed'
                              : 'Not saved yet'
                            : undefined
                        }
                      />
                      <View style={styles.divider} />
                      <EmailCheckbox
                        label="New features and services"
                        value={features}
                        onChange={(next) => {
                          setFeatures(next);
                          setRetry(null);
                          setPhase('ready');
                        }}
                        locked={phase === 'saving'}
                        mark={
                          featuresChanged
                            ? phase === 'uncertain'
                              ? 'Not confirmed'
                              : 'Not saved yet'
                            : undefined
                        }
                      />
                    </View>
                    {phase === 'uncertain' ? (
                      <View style={styles.message}>
                        <EmailNotice kind="uncertain">
                          We couldn’t confirm your email preferences were saved. Try again.
                        </EmailNotice>
                      </View>
                    ) : null}
                    {phase === 'stale' ? (
                      <View style={styles.message}>
                        <EmailNotice kind="uncertain">
                          Your email preferences changed elsewhere. Reload them before saving.
                        </EmailNotice>
                        <EmailButton
                          label="Reload email preferences"
                          kind="outline"
                          onPress={() => {
                            if (accessToken && identity)
                              void load(accessToken, identity, generation.current);
                          }}
                        />
                      </View>
                    ) : null}
                    {!record.email || phase === 'needs-email' ? (
                      <View style={styles.message}>
                        <EmailNotice kind="error">
                          Your Alethical account needs a confirmed email address before you can
                          subscribe to emails.
                        </EmailNotice>
                        <EmailButton
                          label="Try again"
                          kind="outline"
                          onPress={() => {
                            if (accessToken && identity)
                              void load(accessToken, identity, generation.current);
                          }}
                        />
                      </View>
                    ) : null}
                    <View style={[styles.saveRow, isMobile && styles.saveRowMobile]}>
                      <EmailButton
                        label={
                          phase === 'saving'
                            ? 'Saving…'
                            : phase === 'uncertain'
                              ? 'Try again'
                              : 'Save email preferences'
                        }
                        busy={phase === 'saving'}
                        locked={phase === 'stale' || newConsentWithoutEmail}
                        fullWidth={isMobile}
                        minHeight={isMobile ? 54 : 52}
                        onPress={() => {
                          if (retry) void submit(retry);
                          else save();
                        }}
                      />
                      {phase === 'saved' ? (
                        <Text aria-live="polite" style={styles.saved}>
                          ✓ Your email preferences are saved
                        </Text>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </>
            ) : !isLoading ? (
              <Text style={styles.status}>Sign in to manage your email preferences.</Text>
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
  main: {
    width: '100%',
    maxWidth: 792,
    paddingHorizontal: 56,
    paddingTop: 56,
    paddingBottom: 90,
    alignSelf: 'center',
  },
  tablet: { paddingHorizontal: 32 },
  mobile: { paddingHorizontal: 20, paddingTop: 38 },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  heading: {
    fontFamily: t.typography.title,
    fontWeight: t.fontWeights.heavy,
    fontSize: 45,
    lineHeight: 53,
    color: emailColors.ink,
  },
  headingMobile: { fontSize: 34, lineHeight: 42 },
  sendLabel: {
    marginTop: 36,
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    fontSize: 12,
    lineHeight: 19,
    letterSpacing: 1.6,
    color: '#656c66',
  },
  email: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 21,
    lineHeight: 29,
    color: emailColors.ink,
    ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' } : null),
  },
  status: {
    marginTop: 30,
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 16,
    color: emailColors.muted,
  },
  loadFailure: { marginTop: 32, gap: 18 },
  choiceCard: {
    marginTop: 34,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe3e6',
    borderRadius: 16,
  },
  divider: { height: 1, backgroundColor: '#e8ebe9' },
  message: { marginTop: 18, gap: 12 },
  saveRow: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  saveRowMobile: { flexDirection: 'column', alignItems: 'stretch' },
  saved: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: emailColors.ink,
    textAlign: 'center',
  },
});
