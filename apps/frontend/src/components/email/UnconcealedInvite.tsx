import { useCallback, useEffect, useRef, useState } from 'react';
import { theme as t } from '../../theme/tokens';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  completeEmailSubscriptionIntent,
  createEmailSubscriptionIntent,
  readEmailPreferences,
  type EmailPreferences,
} from '../../data/emailSubscriptions';
import {
  EMAIL_SUBSCRIPTION_AUTH_READY_EVENT,
  clearEmailSubscriptionIntent,
  newEmailSubscriptionBrowserKey,
  readEmailSubscriptionIntent,
  saveEmailSubscriptionIntent,
} from '../../lib/emailSubscriptionIntent';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { loadOnDemand } from '../../lib/loadOnDemand';
import { EmailButton, EmailNotice } from './EmailControls';

const UnconcealedConfirmation = loadOnDemand(() =>
  import('./UnconcealedConfirmation').then((part) => ({ default: part.UnconcealedConfirmation })),
);

export function UnconcealedInvite({
  isMobile,
  isTablet,
  onPreferences,
}: {
  isMobile: boolean;
  isTablet: boolean;
  onPreferences: () => void;
}) {
  const { isLoading, isSignedIn, accessToken, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const [record, setRecord] = useState<EmailPreferences | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const [authReadyTick, setAuthReadyTick] = useState(0);
  const completionKey = useRef<string | null>(null);
  const readGeneration = useRef(0);
  const identity = user?.id ?? null;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const previousIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const ready = () => setAuthReadyTick((current) => current + 1);
    window.addEventListener(EMAIL_SUBSCRIPTION_AUTH_READY_EVENT, ready);
    return () => window.removeEventListener(EMAIL_SUBSCRIPTION_AUTH_READY_EVENT, ready);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!accessToken || !identity) return;
      let active = true;
      const current = ++readGeneration.current;
      readEmailPreferences(accessToken)
        .then((result) => {
          if (active && current === readGeneration.current && result.account_id === identity)
            setRecord(result);
        })
        .catch(() => {
          if (active && current === readGeneration.current) setRecord(null);
        });
      return () => {
        active = false;
      };
    }, [accessToken, identity]),
  );

  useEffect(() => {
    if (previousIdentity.current && previousIdentity.current !== identity) {
      clearEmailSubscriptionIntent();
    }
    previousIdentity.current = identity;
    setRecord(null);
    setConfirmationOpen(false);
    completionKey.current = null;
  }, [identity]);

  useEffect(() => {
    if (isLoading || !isSignedIn || !accessToken || !identity) return;
    const pending = readEmailSubscriptionIntent();
    if (!pending?.authReady) return;
    const key = `${identity}:${pending.reference}`;
    if (completionKey.current === key) return;
    completionKey.current = key;
    void completeEmailSubscriptionIntent(accessToken, pending.reference, pending.browserKey)
      .then((show) => {
        if (activeIdentity.current !== identity) return;
        if (readEmailSubscriptionIntent()?.reference !== pending.reference) return;
        clearEmailSubscriptionIntent();
        if (show) setConfirmationOpen(true);
      })
      .catch(() => {
        if (activeIdentity.current !== identity) return;
        if (readEmailSubscriptionIntent()?.reference === pending.reference)
          clearEmailSubscriptionIntent();
        setError(true);
      })
      .finally(() => {
        if (completionKey.current === key) completionKey.current = null;
      });
  }, [isLoading, isSignedIn, accessToken, identity, authReadyTick]);

  const start = async () => {
    if (starting) return;
    setError(false);
    if (isSignedIn) {
      setConfirmationOpen(true);
      return;
    }
    setStarting(true);
    try {
      const browserKey = newEmailSubscriptionBrowserKey();
      const reference = await createEmailSubscriptionIntent(browserKey);
      saveEmailSubscriptionIntent({ reference, browserKey, authReady: false });
      openSignIn({ intent: 'newsletter', returnTo: '/money' });
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  };

  const subscribed = isSignedIn && record?.account_id === identity && record.research === true;
  return (
    <>
      <View
        style={[
          styles.panel,
          isTablet && styles.tablet,
          isMobile && styles.phone,
          isSignedIn && styles.signedIn,
        ]}
      >
        <View style={styles.words}>
          <Text
            accessibilityRole="header"
            aria-level={3}
            style={[styles.title, isMobile && styles.titleMobile]}
          >
            Unconcealed
          </Text>
          <Text style={styles.subtitle}>Minnesota campaign money and lobbying research</Text>
          <Text style={styles.body}>
            We’ll email you about new research. Every piece is free to read on Alethical.
          </Text>
        </View>
        <View
          style={[
            styles.actionColumn,
            isTablet && styles.tabletAction,
            isMobile && styles.phoneAction,
          ]}
        >
          {subscribed ? (
            <>
              <View style={styles.subscribedRow}>
                <Text style={styles.tick}>✓</Text>
                <Text style={styles.subscribedText}>You’re subscribed to Unconcealed</Text>
              </View>
              <View style={styles.preferencesAction}>
                <EmailButton
                  label="Email preferences"
                  onPress={onPreferences}
                  kind="darkOutline"
                  fullWidth
                  minHeight={isMobile ? 54 : 52}
                />
              </View>
            </>
          ) : (
            <>
              <EmailButton
                label={starting ? 'Opening…' : 'Get Unconcealed by email'}
                onPress={() => void start()}
                busy={starting}
                fullWidth
                minHeight={isMobile ? 54 : 52}
                testID="unconcealed-invite"
              />
              {!isSignedIn ? <Text style={styles.helper}>Create an account or sign in</Text> : null}
              {error ? (
                <>
                  <EmailNotice kind="error">We couldn’t open email signup. Try again.</EmailNotice>
                  <EmailButton
                    label="Choose emails in account settings"
                    kind="darkOutline"
                    onPress={onPreferences}
                    fullWidth
                  />
                </>
              ) : null}
            </>
          )}
        </View>
      </View>
      {confirmationOpen && isSignedIn ? (
        <UnconcealedConfirmation
          open={confirmationOpen && isSignedIn}
          accessToken={accessToken}
          accountId={identity}
          onClose={() => setConfirmationOpen(false)}
          onSaved={(result: EmailPreferences) => {
            readGeneration.current += 1;
            setRecord(result);
          }}
          onBack={() => setConfirmationOpen(false)}
          onPreferences={() => {
            setConfirmationOpen(false);
            onPreferences();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 48,
    backgroundColor: '#11150f',
    borderRadius: 18,
    paddingVertical: 38,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: '#11150f',
    ...(Platform.OS === 'web' ? { boxShadow: '0 14px 34px rgba(17,21,15,0.2)' } : null),
  },
  tablet: { gap: 32, paddingVertical: 32, paddingHorizontal: 24 },
  phone: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    paddingVertical: 26,
    paddingHorizontal: 18,
    borderRadius: 16,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 26px rgba(17,21,15,0.2)' } : null),
  },
  signedIn: { minHeight: 176 },
  words: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: t.typography.title,
    fontWeight: t.fontWeights.heavy,
    fontSize: 25,
    lineHeight: 32,
    color: '#ffffff',
  },
  titleMobile: { fontSize: 24 },
  subtitle: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 17,
    lineHeight: 25,
    color: '#e3e9e5',
    marginTop: 3,
  },
  body: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 16,
    lineHeight: 24,
    color: '#b9c2bc',
    marginTop: 13,
  },
  actionColumn: { width: 340, flexShrink: 0 },
  tabletAction: { width: 290 },
  phoneAction: { width: '100%' },
  helper: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#c3cbc5',
    marginTop: 12,
  },
  subscribedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tick: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(61,224,138,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(61,224,138,0.45)',
    color: '#3de08a',
    textAlign: 'center',
    lineHeight: 38,
    fontSize: 22,
  },
  subscribedText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 17,
    lineHeight: 24,
    color: '#ffffff',
  },
  preferencesAction: { marginTop: 20 },
});
