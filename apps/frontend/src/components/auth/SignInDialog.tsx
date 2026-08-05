import { useEffect, useId, useRef } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import { GoogleButton } from '../../theme/primitives';
import { externalLinkProps, routePath } from '../../navigation/links';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import {
  SIGN_IN_ERROR_MESSAGES,
  SignInDialogState,
  signInButtonLabel,
  signInCopy,
} from '../../lib/signIn';

// The one sign-in surface (docs/mockups/sign-in). Same body everywhere; only the
// chrome changes — a centered card on a desktop-width browser, a bottom sheet on
// a phone. Both are one RN Modal, which escapes stacking contexts (the pattern
// BillDetailScreen's BottomSheet already uses).

const isWeb = Platform.OS === 'web';

const TERMS_URL = 'https://www.alethical.com/terms';
const PRIVACY_URL = 'https://www.alethical.com/privacy';

/** Focusable descendants, in DOM order, ignoring anything hidden or inert. */
function focusableChildren(node: HTMLElement | null): HTMLElement[] {
  if (!node) return [];
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/** The green icon tile above the headline; the glyph follows the intent. */
function IntentIcon({ icon, size }: { icon: 'brand' | 'bookmark' | 'capitol'; size: number }) {
  const glyph = Math.round(size * 0.5);
  const green = t.colors.brand.deep;
  return (
    <View style={[styles.iconTile, { width: size, height: size }]}>
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        {icon === 'brand' ? (
          <>
            <Path d="M3 21 L11 4 L11 21 Z" fill={green} />
            <Path d="M21 21 L13 4 L13 21 Z" fill={green} />
          </>
        ) : null}
        {/* A bookmark, not the design's bell: a bell reads as "we'll notify you",
            and sending alerts is not built (#36) — grounded-answers.md rule 6. The
            real payoff is the saved list, which a bookmark states. */}
        {icon === 'bookmark' ? (
          <Path
            d="M6 4 h12 a1 1 0 0 1 1 1 v15 l-7-4 -7 4 V5 a1 1 0 0 1 1-1 Z"
            stroke={green}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : null}
        {icon === 'capitol' ? (
          <>
            <Path
              d="M4 9 L12 4 L20 9"
              stroke={green}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M6 9 V17 M10 9 V17 M14 9 V17 M18 9 V17 M4 20 H20"
              stroke={green}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

function ErrorIcon() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={t.colors.dangerRamp.r600} strokeWidth={2} />
      <Path
        d="M12 7.5 V13"
        stroke={t.colors.dangerRamp.r600}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={16.3} r={1.15} fill={t.colors.dangerRamp.r600} />
    </Svg>
  );
}

function CloseIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke={t.colors.text.faint}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** A legal link that opens in its own tab, so the dialog isn't lost behind it. */
function LegalLink({ label, path, url }: { label: string; path: string; url: string }) {
  return (
    <Text
      {...externalLinkProps(isWeb ? path : url, () => {
        void Linking.openURL(url);
      })}
      style={styles.legalLink}
    >
      {label}
    </Text>
  );
}

export function SignInDialog({
  state,
  onClose,
  onContinue,
}: {
  state: SignInDialogState;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { isMobile } = useResponsive();
  const reduceMotion = useReducedMotion() || prefersReducedMotion();
  // A phone gets the sheet; anything wider gets the centered card. Native has no
  // desktop width, so it is always the sheet.
  const asSheet = !isWeb || isMobile;
  const headingId = useId();
  const cardRef = useRef<View>(null);
  const headingRef = useRef<Text>(null);
  const alertRef = useRef<View>(null);

  const { headline, subcopy, icon } = signInCopy(state.intent, state.billCode);
  const errorMessage = state.errorKind ? SIGN_IN_ERROR_MESSAGES[state.errorKind] : null;
  const connecting = state.status === 'connecting';

  // Web a11y wiring. react-native-web renders Views as divs, so the dialog
  // semantics are set on the real nodes: no RN prop maps to aria-modal, and
  // `accessibilityViewIsModal` is native-only and does nothing here.
  useEffect(() => {
    if (!isWeb || !state.open) return;
    const card = cardRef.current as unknown as HTMLElement | null;
    const heading = headingRef.current as unknown as HTMLElement | null;
    if (heading) heading.setAttribute('id', headingId);
    if (card) {
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', headingId);
      card.setAttribute('tabindex', '-1');
    }
  }, [state.open, headingId, state.intent, state.status]);

  useEffect(() => {
    if (!isWeb || !state.open) return;
    const alert = alertRef.current as unknown as HTMLElement | null;
    if (alert) alert.setAttribute('role', 'alert');
  }, [state.open, state.errorKind]);

  // Focus: into the dialog on open, trapped while it is up, back to whatever
  // opened it on close. Nothing in this repo does this already, and RN has no
  // web equivalent — so it is hand-rolled here, once, for every caller.
  useEffect(() => {
    if (!isWeb || !state.open || typeof document === 'undefined') return;
    const opener = document.activeElement as HTMLElement | null;
    const card = cardRef.current as unknown as HTMLElement | null;
    // The container takes focus first (rather than a control) so a screen reader
    // announces the dialog and its headline before the buttons.
    card?.focus?.();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = focusableChildren(card);
      if (focusables.length === 0) {
        event.preventDefault();
        card?.focus?.();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active && card?.contains(active) && active !== card);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [state.open, onClose]);

  if (!state.open) {
    return null;
  }

  const animationType = reduceMotion ? 'none' : asSheet ? 'slide' : 'fade';

  const body = (
    <>
      <IntentIcon icon={icon} size={asSheet ? 56 : 52} />
      <Text
        ref={headingRef}
        accessibilityRole="header"
        style={[styles.headline, asSheet && styles.headlineSheet]}
      >
        {headline}
      </Text>
      <Text style={[styles.subcopy, asSheet && styles.subcopySheet]}>{subcopy}</Text>

      {errorMessage ? (
        <View ref={alertRef} style={styles.errorBanner}>
          <View style={styles.errorIcon}>
            <ErrorIcon />
          </View>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.action}>
        <GoogleButton
          onPress={onContinue}
          label={signInButtonLabel(state.status)}
          busy={connecting}
          // With motion turned off there is no spinner, so the button says what
          // it is doing instead of showing an unexplained blank.
          busyLabel={reduceMotion ? 'Connecting…' : undefined}
          size={asSheet ? 'lg' : 'md'}
        />
      </View>

      {/* One caption under the button, no terminal period. The design deliberately
          carries no second reassurance line: the subcopy above already says what
          is saved, and Google names what we receive before anyone can finish. */}
      <Text style={[styles.legal, asSheet && styles.legalSheet]}>
        By continuing you agree to our{' '}
        <LegalLink label="Terms of Use" path={routePath.terms()} url={TERMS_URL} /> and{' '}
        <LegalLink label="Privacy Policy" path={routePath.privacy()} url={PRIVACY_URL} />
      </Text>
    </>
  );

  return (
    <Modal visible transparent animationType={animationType} onRequestClose={onClose}>
      <View style={[styles.scrim, asSheet ? styles.scrimSheet : styles.scrimCentered]}>
        {/* The dimmed area closes the dialog. It sits behind the card (earlier
            sibling), so taps on the card itself never reach it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sign-in"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          ref={cardRef}
          style={[
            asSheet ? styles.sheet : styles.card,
            isWeb
              ? ((asSheet ? styles.sheetShadowWeb : styles.cardShadowWeb) as object)
              : (t.shadows.lg as object),
          ]}
        >
          {asSheet ? <View style={styles.grabHandle} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              asSheet && styles.closeSheet,
              pressed && styles.closePressed,
            ]}
          >
            <CloseIcon />
          </Pressable>
          <View style={asSheet ? styles.sheetBody : undefined}>{body}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,14,12,0.55)' },
  scrimCentered: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  scrimSheet: { justifyContent: 'flex-end' },
  card: {
    width: 460,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 34,
    paddingBottom: 30,
  },
  cardShadowWeb: { boxShadow: '0 30px 80px rgba(10,14,12,0.4)' },
  sheet: {
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
  sheetShadowWeb: { boxShadow: '0 -18px 50px rgba(10,14,12,0.28)' },
  sheetBody: { paddingTop: 14 },
  grabHandle: {
    width: 40,
    height: 5,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.borders.base,
    alignSelf: 'center',
    marginBottom: 6,
  },
  close: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    zIndex: 1,
  },
  // A phone target is 44x44 with its own tinted plate, per the design.
  closeSheet: {
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.s300,
  },
  closePressed: { backgroundColor: t.colors.surfaces.s400 },
  iconTile: {
    borderRadius: 14,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    marginTop: 20,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  headlineSheet: { marginTop: 18, fontSize: t.fontSizes.h3 },
  subcopy: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.muted,
  },
  subcopySheet: { marginTop: 9 },
  errorBanner: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: '#fdecec',
    borderWidth: 1,
    borderColor: '#f4c9c6',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  errorIcon: { marginTop: 1 },
  errorText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    // Darker than the design's #8f2a20 fill-mate would need; this is the token
    // ramp's r800 on the pink banner, which clears WCAG AA for small text.
    color: t.colors.dangerRamp.r800,
  },
  action: { marginTop: 24 },
  legal: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    lineHeight: 19,
    color: t.colors.text.faint,
  },
  legalSheet: { fontSize: t.fontSizes.meta, lineHeight: 20 },
  legalLink: { color: t.colors.text.green, fontWeight: t.fontWeights.semibold },
});
