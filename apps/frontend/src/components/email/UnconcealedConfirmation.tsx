import { useEffect, useRef, useState } from 'react';
import { theme as t } from '../../theme/tokens';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ApiError } from '../../data/api';
import {
  readEmailPreferences,
  saveEmailPreferences,
  type EmailPreferences,
  type EmailPreferenceSave,
} from '../../data/emailSubscriptions';
import { useResponsive } from '../../hooks/useResponsive';
import { SignInContainer } from '../auth/SignInContainer';
import { EmailButton, EmailCheckbox, EmailNotice, emailColors } from './EmailControls';

function EnvelopeTile() {
  return (
    <View style={styles.iconTile}>
      <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" aria-hidden>
        <Path
          d="M3 6h18v12H3zM3.5 7l8.5 6 8.5-6"
          stroke={emailColors.ink}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

type Phase =
  'loading' | 'load-error' | 'ready' | 'saving' | 'uncertain' | 'needs-email' | 'success';

export function UnconcealedConfirmation({
  open,
  accessToken,
  accountId,
  onClose,
  onSaved,
  onBack,
  onPreferences,
}: {
  open: boolean;
  accessToken: string | null;
  accountId: string | null;
  onClose: () => void;
  onSaved: (preferences: EmailPreferences) => void;
  onBack: () => void;
  onPreferences: () => void;
}) {
  const { isMobile } = useResponsive();
  const [phase, setPhase] = useState<Phase>('loading');
  const [saved, setSaved] = useState<EmailPreferences | null>(null);
  const [features, setFeatures] = useState(false);
  const [retry, setRetry] = useState<EmailPreferenceSave | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const generation = useRef(0);
  const saving = useRef<number | null>(null);

  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    // React Native Web places Modal in a body portal outside #root. Hide the
    // page behind this dialog from screen readers while the modal is open.
    const page = document.getElementById('root');
    if (!page) return;
    const previous = page.getAttribute('aria-hidden');
    const active = document.activeElement as HTMLElement | null;
    if (active && page.contains(active)) active.blur();
    page.setAttribute('aria-hidden', 'true');
    return () => {
      if (previous === null) page.removeAttribute('aria-hidden');
      else page.setAttribute('aria-hidden', previous);
    };
  }, [open]);

  const load = async (token: string, id: string, current: number) => {
    setPhase('loading');
    try {
      const record = await readEmailPreferences(token);
      if (generation.current !== current) return;
      if (record.account_id !== id) {
        setPhase('load-error');
        return;
      }
      setSaved(record);
      setFeatures(record.features === true);
      setRetry(null);
      setPhase(!record.email ? 'needs-email' : record.research === true ? 'success' : 'ready');
      if (record.research === true) onSaved(record);
    } catch {
      if (generation.current === current) setPhase('load-error');
    }
  };

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    if (!open || !accessToken || !accountId) return;
    setStaleNotice(false);
    void load(accessToken, accountId, current);
    return () => {
      generation.current += 1;
    };
  }, [open, accessToken, accountId]);

  const submit = async (body: EmailPreferenceSave) => {
    if (!accessToken || !accountId) return;
    const token = accessToken;
    const id = accountId;
    const current = generation.current;
    if (saving.current === current) return;
    saving.current = current;
    setPhase('saving');
    try {
      const record = await saveEmailPreferences(token, body);
      if (generation.current !== current || record.account_id !== id) return;
      setSaved(record);
      setFeatures(record.features === true);
      setRetry(null);
      if (!record.email) setPhase('needs-email');
      else if (record.research === true) setPhase('success');
      else {
        setStaleNotice(true);
        setPhase('ready');
      }
      if (record.research === true) onSaved(record);
    } catch (error) {
      if (generation.current !== current) return;
      if (error instanceof ApiError && error.status === 409) {
        // A newer stop or change won. Do not automatically replay this older
        // request, especially if it would turn research back on.
        setRetry(null);
        await load(token, id, current);
        if (generation.current === current) setStaleNotice(true);
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
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

  const subscribe = () => {
    if (!saved?.email) return;
    setStaleNotice(false);
    const body: EmailPreferenceSave = {
      research: true,
      ...(features !== (saved.features === true) ? { features } : {}),
      expected_version: saved.version,
      expected_account_id: saved.account_id,
      expected_email: saved.email,
      idempotency_key: crypto.randomUUID(),
      source: 'confirmation',
    };
    void submit(body);
  };

  return (
    <SignInContainer
      open={open}
      focusKey={phase === 'success' ? 'unconcealed-success' : 'unconcealed-confirm'}
      focusTitleOnKeyChange
      title={phase === 'success' ? 'You’re subscribed to Unconcealed' : 'Get Unconcealed by email'}
      icon={<EnvelopeTile />}
      onClose={onClose}
    >
      <View style={styles.body}>
        {saved || phase === 'loading' ? (
          <>
            <Text style={styles.smallLabel}>SEND TO</Text>
            <View style={styles.addressBox}>
              <Text style={styles.address}>{saved?.email ?? 'Loading…'}</Text>
            </View>
          </>
        ) : null}

        {phase === 'loading' ? (
          <View style={styles.choiceSlot}>
            <Text accessibilityRole="text" aria-live="polite" style={styles.muted}>
              Loading email preferences…
            </Text>
          </View>
        ) : null}
        {phase === 'load-error' ? (
          <View style={styles.choiceSlot}>
            <EmailNotice kind="error">We couldn’t load your email preferences</EmailNotice>
          </View>
        ) : null}
        {phase === 'ready' || phase === 'saving' || phase === 'uncertain' ? (
          <View style={styles.choiceSlot}>
            <EmailCheckbox
              label="Also email me about new Alethical features and services"
              value={features}
              onChange={(value) => {
                setFeatures(value);
                setRetry(null);
                if (phase === 'uncertain') setPhase('ready');
              }}
              locked={phase === 'saving'}
            />
          </View>
        ) : null}

        {phase === 'uncertain' ? (
          <EmailNotice kind="uncertain">
            You’re signed in, but we couldn’t confirm your email choices were saved
          </EmailNotice>
        ) : null}
        {staleNotice && phase === 'ready' ? (
          <EmailNotice kind="uncertain">
            Your email choices changed. Review them and press Subscribe to Unconcealed again.
          </EmailNotice>
        ) : null}
        {phase === 'needs-email' ? (
          <EmailNotice kind="error">
            Your Alethical account needs a confirmed email address before you can subscribe.
          </EmailNotice>
        ) : null}

        {phase === 'success' ? (
          <View style={styles.actions}>
            <EmailButton
              label="Back to Money in politics"
              onPress={onBack}
              kind="green"
              fullWidth
              minHeight={isMobile ? 54 : 52}
            />
            <EmailButton
              label="Email preferences"
              onPress={onPreferences}
              kind="outline"
              fullWidth
              minHeight={isMobile ? 54 : 52}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <EmailButton
              reserveLabel="Subscribe to Unconcealed"
              label={
                phase === 'saving'
                  ? 'Saving…'
                  : phase === 'uncertain' || phase === 'load-error' || phase === 'needs-email'
                    ? 'Try again'
                    : 'Subscribe to Unconcealed'
              }
              onPress={() => {
                if ((phase === 'load-error' || phase === 'needs-email') && accessToken && accountId)
                  void load(accessToken, accountId, generation.current);
                else if (retry) void submit(retry);
                else subscribe();
              }}
              kind={phase === 'load-error' || phase === 'needs-email' ? 'outline' : 'green'}
              busy={phase === 'saving'}
              locked={phase === 'loading'}
              fullWidth
              minHeight={isMobile ? 54 : 52}
            />
            {phase !== 'load-error' ? (
              <Text style={styles.foot}>Unsubscribe at any time</Text>
            ) : null}
          </View>
        )}
      </View>
    </SignInContainer>
  );
}

const styles = StyleSheet.create({
  iconTile: {
    width: 52,
    height: 52,
    backgroundColor: '#f4f5f8',
    borderColor: '#dfe3e6',
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { marginTop: 8 },
  smallLabel: {
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    fontSize: 12,
    letterSpacing: 1.7,
    color: '#656c66',
  },
  addressBox: {
    backgroundColor: '#f5f6f7',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  address: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    fontSize: 16,
    lineHeight: 23,
    color: emailColors.ink,
    ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' } : null),
  },
  choiceSlot: { minHeight: 66, justifyContent: 'center', marginTop: 16 },
  muted: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 16,
    color: emailColors.muted,
  },
  actions: { gap: 10, marginTop: 22 },
  foot: {
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.regular,
    fontSize: 14,
    color: emailColors.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});
