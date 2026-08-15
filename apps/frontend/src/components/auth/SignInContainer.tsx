import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

function focusableChildren(node: HTMLElement | null): HTMLElement[] {
  if (!node) return [];
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])';
  return Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getAttribute('aria-disabled') !== 'true' &&
      (element.getClientRects().length > 0 || element === document.activeElement),
  );
}

function CloseIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke={t.colors.text.faint}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SignInContainer({
  open = true,
  focusKey,
  variant = 'flow',
  title,
  description,
  icon,
  children,
  onClose,
}: {
  open?: boolean;
  focusKey?: string;
  variant?: 'flow' | 'page';
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}) {
  const { isMobile } = useResponsive();
  const reduceMotion = useReducedMotion();
  const titleId = `auth-title-${useId()}`;
  const generatedDescriptionId = useId();
  const descriptionId = description ? `auth-description-${generatedDescriptionId}` : undefined;
  const cardRef = useRef<View>(null);
  const closeRef = useRef<View>(null);
  const [closeFocused, setCloseFocused] = useState(false);
  const isPage = variant === 'page';
  const asSheet = !isPage && isMobile;

  useEffect(() => {
    if (!isWeb || !open || isPage || typeof document === 'undefined') return;
    const opener = document.activeElement as HTMLElement | null;
    const card = cardRef.current as unknown as HTMLElement | null;
    const close = closeRef.current as unknown as HTMLElement | null;
    close?.focus();
    if (!close && card) {
      card.setAttribute('tabindex', '-1');
      card.focus();
      card.removeAttribute('tabindex');
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
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

      const active = document.activeElement as HTMLElement | null;
      const activeIndex = active ? focusables.indexOf(active) : -1;
      const nextIndex = event.shiftKey
        ? activeIndex <= 0
          ? focusables.length - 1
          : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusables.length - 1
          ? 0
          : activeIndex + 1;
      event.preventDefault();
      focusables[nextIndex].focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [focusKey, isPage, onClose, open]);

  if (!open) return null;

  const heading = (
    <>
      {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
      <Text
        nativeID={titleId}
        accessibilityRole="header"
        aria-level={isPage ? 1 : 2}
        style={[styles.title, asSheet && styles.titleSheet]}
      >
        {title}
      </Text>
      {description ? (
        <View nativeID={descriptionId} style={styles.descriptionWrap}>
          {typeof description === 'string' ? (
            <Text style={styles.description}>{description}</Text>
          ) : (
            description
          )}
        </View>
      ) : null}
    </>
  );

  const cardAccessibility = isWeb
    ? isPage
      ? ({ role: 'main', 'aria-labelledby': titleId, 'aria-describedby': descriptionId } as object)
      : ({} as object)
    : null;

  const body = (
    <>
      {heading}
      <View style={styles.children}>{children}</View>
    </>
  );

  if (isPage) {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
      >
        <View
          ref={cardRef}
          {...cardAccessibility}
          style={[
            styles.pageCard,
            isMobile && styles.pageCardMobile,
            isWeb ? styles.pageCardShadowWeb : (t.shadows.card as object),
          ]}
        >
          {body}
        </View>
      </ScrollView>
    );
  }

  const animationType = reduceMotion ? 'none' : asSheet ? 'slide' : 'fade';

  return (
    <Modal
      visible
      transparent
      animationType={animationType}
      accessibilityLabel={title}
      onRequestClose={() => onClose?.()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.scrim, asSheet ? styles.scrimSheet : styles.scrimCentered]}
      >
        {onClose ? (
          <Pressable
            accessible={false}
            focusable={false}
            {...(isWeb ? ({ 'aria-hidden': true } as object) : null)}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          ref={cardRef}
          {...cardAccessibility}
          style={[
            asSheet ? styles.sheet : styles.card,
            asSheet && sheetMaxHeightWeb,
            isWeb
              ? asSheet
                ? styles.sheetShadowWeb
                : styles.cardShadowWeb
              : (t.shadows.lg as object),
          ]}
        >
          {asSheet ? (
            <View style={styles.sheetHeader}>
              <View style={styles.grabHandle} />
              {onClose ? (
                <Pressable
                  ref={closeRef}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onBlur={() => setCloseFocused(false)}
                  onFocus={() => setCloseFocused(true)}
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.close,
                    closeFocused && focusRingWeb,
                    pressed && styles.closePressed,
                  ]}
                >
                  <CloseIcon />
                </Pressable>
              ) : null}
            </View>
          ) : onClose ? (
            <Pressable
              ref={closeRef}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onBlur={() => setCloseFocused(false)}
              onFocus={() => setCloseFocused(true)}
              onPress={onClose}
              style={({ pressed }) => [
                styles.close,
                styles.closeCard,
                closeFocused && focusRingWeb,
                pressed && styles.closePressed,
              ]}
            >
              <CloseIcon />
            </Pressable>
          ) : null}
          <ScrollView
            style={asSheet ? styles.sheetScroll : styles.cardScroll}
            contentContainerStyle={asSheet ? [styles.sheetBody, sheetBodySafeAreaWeb] : undefined}
            keyboardShouldPersistTaps="handled"
          >
            {body}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const sheetMaxHeightWeb = isWeb ? ({ maxHeight: '92dvh' } as object) : null;
const sheetBodySafeAreaWeb = isWeb
  ? ({ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' } as object)
  : null;
const focusRingWeb = isWeb
  ? ({
      outlineColor: '#7c5cff',
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    } as object)
  : null;

/** Exported so node descriptions (e.g. ones carrying a mail link) match plain ones. */
export const descriptionTextStyle = {
  fontFamily: t.typography.body,
  fontSize: t.fontSizes.bodyLg,
  lineHeight: 24,
  color: t.colors.text.muted,
} as const;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,14,12,0.55)' },
  scrimCentered: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  scrimSheet: { justifyContent: 'flex-end' },
  card: {
    width: 460,
    maxWidth: '100%',
    maxHeight: '90%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 34,
    paddingBottom: 30,
  },
  cardScroll: { flexGrow: 0, flexShrink: 1 },
  cardShadowWeb: { boxShadow: '0 30px 80px rgba(10,14,12,0.4)' },
  sheet: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  sheetShadowWeb: { boxShadow: '0 -18px 50px rgba(10,14,12,0.28)' },
  sheetHeader: {
    height: 56,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { paddingTop: 8, paddingHorizontal: 24, paddingBottom: 32 },
  grabHandle: {
    width: 40,
    height: 5,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.borders.base,
  },
  close: {
    position: 'absolute',
    top: 6,
    right: 16,
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.s300,
    zIndex: 1,
  },
  closeCard: { top: 16, right: 16, backgroundColor: 'transparent' },
  closePressed: { backgroundColor: t.colors.surfaces.s400 },
  page: { flex: 1, backgroundColor: t.colors.surfaces.s100 },
  pageContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  pageCard: {
    width: 460,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 34,
    paddingBottom: 30,
  },
  pageCardMobile: { paddingTop: 28, paddingHorizontal: 24, paddingBottom: 28 },
  pageCardShadowWeb: { boxShadow: '0 8px 24px rgba(17,21,15,0.05)' },
  iconSlot: { marginBottom: 20, alignSelf: 'flex-start' },
  title: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    lineHeight: 32,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  titleSheet: { fontSize: 23, lineHeight: 30 },
  descriptionWrap: { marginTop: 9 },
  description: descriptionTextStyle,
  children: { marginTop: 22 },
});
