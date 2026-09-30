import { useCallback, useEffect, useRef, useState } from 'react';
import { theme as t } from '../../theme/tokens';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
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
  const subscribedStatus = (
    <View style={styles.subscribedRow}>
      <View style={styles.tick} aria-hidden>
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path
            d="M5 12.5 L10 17.5 L19 7"
            stroke="#3de08a"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
      <Text style={[styles.subscribedText, isMobile && styles.subscribedTextMobile]}>
        You’re subscribed to Unconcealed
      </Text>
    </View>
  );
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
            style={[styles.title, isTablet && styles.titleTablet, isMobile && styles.titleMobile]}
          >
            Get <Text style={styles.name}>Unconcealed</Text> research reports by email as we
            discover them
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
              {subscribedStatus}
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
              {isSignedIn && !error ? (
                // Reserve the actual wrapping status, not just a fixed panel floor.
                // This copy has no controls and is hidden from assistive technology.
                <View aria-hidden pointerEvents="none" style={styles.reservedStatus}>
                  {subscribedStatus}
                  <View
                    style={[
                      styles.preferencesAction,
                      styles.reservedButton,
                      { minHeight: isMobile ? 54 : 52 },
                    ]}
                  >
                    <Text style={styles.reservedButtonText}>Email preferences</Text>
                  </View>
                </View>
              ) : null}
              <View
                style={
                  isSignedIn && !error
                    ? [styles.centeredSignup, isMobile && styles.phoneSignup]
                    : undefined
                }
              >
                <EmailButton
                  reserveLabel="Opening…"
                  label={starting ? 'Opening…' : 'Sign up'}
                  onPress={() => void start()}
                  busy={starting}
                  fullWidth
                  minHeight={isMobile ? 54 : 52}
                  testID="unconcealed-invite"
                />
                {!isSignedIn ? (
                  <Text style={styles.helper}>Create an account or sign in</Text>
                ) : null}
                {error ? (
                  <>
                    <EmailNotice kind="error">
                      We couldn’t open email signup. Try again.
                    </EmailNotice>
                    <EmailButton
                      label="Choose emails in account settings"
                      kind="darkOutline"
                      onPress={onPreferences}
                      fullWidth
                    />
                  </>
                ) : null}
              </View>
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
    gap: 16,
    paddingVertical: 26,
    paddingHorizontal: 18,
    borderRadius: 16,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 26px rgba(17,21,15,0.2)' } : null),
  },
  signedIn: { minHeight: 176 },
  words: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 24,
    lineHeight: 27.6,
    letterSpacing: -0.48,
    color: '#ffffff',
    ...(Platform.OS === 'web' ? { textWrap: 'pretty' as const } : null),
  },
  titleTablet: { fontSize: 23, lineHeight: 26.45, letterSpacing: -0.46 },
  titleMobile: { fontSize: 21, lineHeight: 24.15, letterSpacing: -0.42 },
  name: { fontWeight: t.fontWeights.heavy },
  actionColumn: { width: 340, flexShrink: 0 },
  tabletAction: { width: 290 },
  phoneAction: { width: '100%' },
  reservedStatus: { opacity: 0 },
  reservedButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reservedButtonText: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  centeredSignup: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
  },
  phoneSignup: { justifyContent: 'flex-start' },
  helper: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#c3cbc5',
    marginTop: 12,
  },
  subscribedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    gap: 10,
  },
  tick: {
    width: 26,
    height: 26,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(61,224,138,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(61,224,138,0.45)',
  },
  subscribedText: {
    flexShrink: 1,
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.bold,
    fontSize: 16.5,
    lineHeight: 24,
    color: '#ffffff',
  },
  subscribedTextMobile: { fontSize: 16 },
  preferencesAction: { marginTop: 20 },
});
