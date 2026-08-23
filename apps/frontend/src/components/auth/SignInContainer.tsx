import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])';

export const accountPanelHeaderContentGap = 14;

function potentialFocusableChildren(node: HTMLElement | null): HTMLElement[] {
  if (!node) return [];
  return Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.tabIndex >= 0 && element.getAttribute('aria-disabled') !== 'true',
  );
}

function focusableChildren(node: HTMLElement | null): HTMLElement[] {
  return potentialFocusableChildren(node).filter(
    (element) => element.getClientRects().length > 0 || element === document.activeElement,
  );
}

function CloseIcon() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke={t.colors.text.faint}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function BackIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M14.5 5.5 L8 12 L14.5 18.5"
        stroke={t.colors.text.muted}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SignInContainer({
  open = true,
  focusKey,
  variant = 'flow',
  accountPanel = false,
  title,
  description,
  icon,
  headerIcon,
  backAction,
  contentGap,
  children,
  onClose,
}: {
  open?: boolean;
  focusKey?: string;
  variant?: 'flow' | 'page';
  accountPanel?: boolean;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  headerIcon?: ReactNode;
  backAction?: { label: string; onPress: () => void; disabled?: boolean };
  contentGap?: number;
  children: ReactNode;
  onClose?: () => void;
}) {
  const { isMobile } = useResponsive();
  const reduceMotion = useReducedMotion();
  const titleId = `auth-title-${useId()}`;
  const generatedDescriptionId = useId();
  const descriptionId = description ? `auth-description-${generatedDescriptionId}` : undefined;
  const cardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const closeRef = useRef<View>(null);
  const titleRef = useRef<Text>(null);
  // Android shrinks the visual viewport when its keyboard opens. That rebuilds
  // parent callbacks, but it must not make an already-open dialog focus Close.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [closeFocused, setCloseFocused] = useState(false);
  const [backFocused, setBackFocused] = useState(false);
  const [titleBottom, setTitleBottom] = useState(0);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);
  const [visualViewportHeight, setVisualViewportHeight] = useState<number | null>(null);
  const isPage = variant === 'page';
  const asSheet = !isPage && isMobile;
  const useAccountPanel = accountPanel && !isPage;
  const frameKey = focusKey ?? title;
  const incomingFrame = {
    frameKey,
    title,
    description,
    icon,
    headerIcon,
    backAction,
    contentGap,
    children,
  };
  const incomingFrameRef = useRef(incomingFrame);
  incomingFrameRef.current = incomingFrame;
  const frameRef = useRef(incomingFrame);
  const [displayedFrameKey, setDisplayedFrameKey] = useState(frameKey);
  const frameOpacity = useRef(new Animated.Value(1)).current;
  const frameOffset = useRef(new Animated.Value(0)).current;
  const transitionRun = useRef(0);
  const sameFrameFocus = useRef<{ frameKey: string; index: number } | null>(null);

  if (!useAccountPanel || displayedFrameKey === frameKey) frameRef.current = incomingFrame;
  const displayedFrame =
    !useAccountPanel || displayedFrameKey === frameKey ? incomingFrame : frameRef.current;

  useEffect(() => {
    if (!open || !useAccountPanel || frameRef.current.frameKey === frameKey) return;
    const run = transitionRun.current + 1;
    transitionRun.current = run;
    const showIncomingFrame = () => {
      if (transitionRun.current !== run) return;
      frameRef.current = incomingFrameRef.current;
      frameOpacity.setValue(reduceMotion ? 1 : 0);
      frameOffset.setValue(reduceMotion ? 0 : 8);
      setDisplayedFrameKey(frameKey);
      if (reduceMotion) return;
      Animated.parallel([
        Animated.timing(frameOpacity, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(frameOffset, {
          toValue: 0,
          duration: 90,
          useNativeDriver: true,
        }),
      ]).start();
    };

    if (reduceMotion) {
      showIncomingFrame();
      return;
    }

    Animated.timing(frameOpacity, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) showIncomingFrame();
    });

    return () => {
      transitionRun.current += 1;
      frameOpacity.stopAnimation();
      frameOffset.stopAnimation();
    };
  }, [frameKey, frameOffset, frameOpacity, open, reduceMotion, useAccountPanel]);

  useEffect(() => {
    if (open || !useAccountPanel) return;
    transitionRun.current += 1;
    frameOpacity.stopAnimation();
    frameOffset.stopAnimation();
    frameRef.current = incomingFrameRef.current;
    frameOpacity.setValue(1);
    frameOffset.setValue(0);
    setDisplayedFrameKey(frameKey);
  }, [frameKey, frameOffset, frameOpacity, open, useAccountPanel]);

  useEffect(() => {
    if (!isWeb || !open || !useAccountPanel || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    const updateHeight = () => setVisualViewportHeight(viewport?.height ?? window.innerHeight);
    updateHeight();
    viewport?.addEventListener('resize', updateHeight);
    window.addEventListener('resize', updateHeight);
    return () => {
      viewport?.removeEventListener('resize', updateHeight);
      window.removeEventListener('resize', updateHeight);
    };
  }, [open, useAccountPanel]);

  useEffect(() => {
    if (!open || (!isPage && !useAccountPanel)) return;
    if (useAccountPanel) {
      setBackFocused(false);
      setCloseFocused(false);
    }
    if (isWeb && typeof document !== 'undefined') {
      const titleElement = titleRef.current as unknown as HTMLElement | null;
      if (!titleElement) return;
      titleElement.focus();
      return;
    }
    const titleHandle = findNodeHandle(titleRef.current);
    if (titleHandle !== null) AccessibilityInfo.setAccessibilityFocus(titleHandle);
  }, [displayedFrameKey, isPage, open, useAccountPanel]);

  useEffect(() => {
    if (!useAccountPanel) return;
    setShowHeaderTitle(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [displayedFrameKey, useAccountPanel]);

  useLayoutEffect(() => {
    if (!isWeb || !open || isPage || typeof document === 'undefined') return;
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, [isPage, open]);

  useLayoutEffect(() => {
    if (!isWeb || !open || !isPage || typeof document === 'undefined') return;
    const card = cardRef.current as unknown as HTMLElement | null;
    const restore = sameFrameFocus.current;
    sameFrameFocus.current = null;
    const active = document.activeElement as HTMLElement | null;
    if (restore?.frameKey === frameKey && card && !card.contains(active)) {
      potentialFocusableChildren(card)[restore.index]?.focus();
    }

    return () => {
      const currentCard = cardRef.current as unknown as HTMLElement | null;
      const currentActive = document.activeElement as HTMLElement | null;
      const index = focusableChildren(currentCard).indexOf(currentActive as HTMLElement);
      if (index >= 0) sameFrameFocus.current = { frameKey, index };
    };
  });

  useEffect(() => {
    if (!isWeb || !open || isPage || typeof document === 'undefined') return;
    const card = cardRef.current as unknown as HTMLElement | null;
    const close = closeRef.current as unknown as HTMLElement | null;
    if (!useAccountPanel) close?.focus();
    if (!useAccountPanel && !close && card) {
      card.setAttribute('tabindex', '-1');
      card.focus();
      card.removeAttribute('tabindex');
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
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
    };
  }, [displayedFrameKey, isPage, open, useAccountPanel]);

  if (!open) return null;

  const heading = (
    <View style={useAccountPanel && styles.accountHeading}>
      {displayedFrame.icon ? (
        <View style={[styles.iconSlot, useAccountPanel && styles.accountIconSlot]}>
          {displayedFrame.icon}
        </View>
      ) : null}
      <Text
        ref={titleRef}
        nativeID={titleId}
        accessibilityRole="header"
        aria-level={isPage ? 1 : 2}
        onLayout={(event) =>
          setTitleBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)
        }
        {...(isWeb ? ({ tabIndex: -1 } as object) : null)}
        style={[
          styles.title,
          asSheet && styles.titleSheet,
          useAccountPanel && styles.accountTitle,
          focusedHeadingWeb,
        ]}
      >
        {displayedFrame.title}
      </Text>
      {displayedFrame.description ? (
        <View
          nativeID={descriptionId}
          style={[styles.descriptionWrap, useAccountPanel && styles.accountDescriptionWrap]}
        >
          {typeof displayedFrame.description === 'string' ? (
            <Text style={[styles.description, useAccountPanel && accountPanelDescriptionTextStyle]}>
              {displayedFrame.description}
            </Text>
          ) : (
            displayedFrame.description
          )}
        </View>
      ) : null}
    </View>
  );

  const cardAccessibility =
    isWeb && isPage
      ? ({ role: 'main', 'aria-labelledby': titleId, 'aria-describedby': descriptionId } as object)
      : null;
  const modalAccessibility =
    isWeb && !isPage
      ? ({ 'aria-labelledby': titleId, 'aria-describedby': descriptionId } as object)
      : null;

  const bodyContents = (
    <View>
      {heading}
      <View
        style={[
          styles.children,
          useAccountPanel &&
            typeof displayedFrame.contentGap === 'number' && {
              marginTop: displayedFrame.contentGap,
            },
        ]}
      >
        {displayedFrame.children}
      </View>
    </View>
  );

  const body = useAccountPanel ? (
    <Animated.View style={{ opacity: frameOpacity, transform: [{ translateY: frameOffset }] }}>
      {bodyContents}
    </Animated.View>
  ) : (
    bodyContents
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
  const accountPanelMaxHeight =
    isWeb && useAccountPanel && visualViewportHeight !== null
      ? { maxHeight: Math.max(0, visualViewportHeight - (asSheet ? 45 : 80)) }
      : null;
  const onModalRequestClose = () => {
    if (displayedFrame.backAction) {
      if (!displayedFrame.backAction.disabled) displayedFrame.backAction.onPress();
      return;
    }
    onClose?.();
  };
  const accountHeader = useAccountPanel ? (
    <View style={[styles.accountHeader, asSheet && styles.accountHeaderSheet]}>
      {asSheet ? <View aria-hidden style={styles.grabHandle} /> : null}
      {displayedFrame.backAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={displayedFrame.backAction.label}
          accessibilityState={{ disabled: displayedFrame.backAction.disabled }}
          disabled={displayedFrame.backAction.disabled}
          onBlur={() => setBackFocused(false)}
          onFocus={() => setBackFocused(true)}
          onPress={displayedFrame.backAction.onPress}
          style={({ pressed }) => [
            styles.back,
            asSheet ? styles.accountControlSheet : styles.accountControlCard,
            backFocused && focusRingWeb,
            pressed && styles.headerControlPressed,
          ]}
        >
          <BackIcon />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : displayedFrame.headerIcon ? (
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          {...(isWeb ? ({ 'aria-hidden': true } as object) : null)}
          style={[
            styles.headerIconSlot,
            asSheet ? styles.accountControlSheet : styles.accountControlCard,
          ]}
        >
          {displayedFrame.headerIcon}
        </View>
      ) : null}
      {showHeaderTitle ? (
        <Text
          accessible={false}
          numberOfLines={1}
          {...(isWeb ? ({ 'aria-hidden': true } as object) : null)}
          style={styles.stickyTitle}
        >
          {displayedFrame.title}
        </Text>
      ) : null}
      {onClose ? (
        <Pressable
          ref={closeRef}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onBlur={() => setCloseFocused(false)}
          onFocus={() => setCloseFocused(true)}
          onPress={onClose}
          style={({ pressed }) => [
            styles.accountClose,
            asSheet ? styles.accountControlSheet : styles.accountControlCard,
            closeFocused && focusRingWeb,
            pressed && styles.headerControlPressed,
          ]}
        >
          <CloseIcon />
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return (
    <Modal
      visible
      transparent
      animationType={animationType}
      {...modalAccessibility}
      accessibilityLabel={displayedFrame.title}
      onRequestClose={onModalRequestClose}
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
            asSheet
              ? [styles.sheet, useAccountPanel && styles.accountSheet]
              : [styles.card, useAccountPanel && styles.accountCard],
            asSheet && !useAccountPanel && sheetMaxHeightWeb,
            accountPanelMaxHeight,
            isWeb
              ? asSheet
                ? styles.sheetShadowWeb
                : styles.cardShadowWeb
              : (t.shadows.lg as object),
          ]}
        >
          {accountHeader}
          {!useAccountPanel && asSheet ? (
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
          ) : !useAccountPanel && onClose ? (
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
            ref={scrollRef}
            style={asSheet ? styles.sheetScroll : styles.cardScroll}
            contentContainerStyle={
              useAccountPanel
                ? [
                    asSheet ? styles.accountSheetBody : styles.accountCardBody,
                    asSheet && accountSheetBodySafeAreaWeb,
                  ]
                : asSheet
                  ? [styles.sheetBody, sheetBodySafeAreaWeb]
                  : undefined
            }
            keyboardShouldPersistTaps="handled"
            onScroll={
              useAccountPanel
                ? (event) => {
                    const realTitleBottom = accountPanelHeaderContentGap + titleBottom;
                    setShowHeaderTitle(event.nativeEvent.contentOffset.y >= realTitleBottom);
                  }
                : undefined
            }
            scrollEventThrottle={16}
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
const accountSheetBodySafeAreaWeb = isWeb
  ? ({ paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' } as object)
  : null;
const focusRingWeb = isWeb
  ? ({
      outlineColor: '#7c5cff',
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    } as object)
  : null;
const focusedHeadingWeb = isWeb ? ({ outlineStyle: 'none', outlineWidth: 0 } as object) : null;

/** Exported so node descriptions (e.g. ones carrying a mail link) match plain ones. */
export const descriptionTextStyle = {
  fontFamily: t.typography.body,
  fontSize: t.fontSizes.bodyLg,
  lineHeight: 24,
  color: t.colors.text.muted,
} as const;

/** Account-panel descriptions use the compact type from the accepted narrow-screen design. */
export const accountPanelDescriptionTextStyle = {
  fontFamily: t.typography.body,
  fontSize: 15,
  lineHeight: 22.5,
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
  accountCard: {
    width: 420,
    borderRadius: 16,
    paddingTop: 0,
    paddingHorizontal: 0,
    paddingBottom: 0,
    overflow: 'hidden',
  },
  sheet: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  sheetShadowWeb: { boxShadow: '0 -18px 50px rgba(10,14,12,0.28)' },
  accountSheet: { overflow: 'hidden' },
  sheetHeader: {
    height: 84,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { paddingTop: 0, paddingHorizontal: 24, paddingBottom: 32 },
  grabHandle: {
    position: 'absolute',
    top: 12,
    left: '50%',
    marginLeft: -20,
    width: 40,
    height: 5,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.borders.base,
  },
  close: {
    position: 'absolute',
    top: 24,
    right: 24,
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.s300,
    zIndex: 1,
  },
  closeCard: { top: 20, right: 20, backgroundColor: 'transparent' },
  closePressed: { backgroundColor: t.colors.surfaces.s400 },
  accountHeader: {
    position: 'relative',
    height: 66,
    marginHorizontal: 20,
    flexShrink: 0,
    zIndex: 2,
  },
  accountHeaderSheet: { marginHorizontal: 22 },
  accountControlSheet: { top: 22 },
  accountControlCard: { top: 20 },
  headerIconSlot: {
    position: 'absolute',
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  back: {
    position: 'absolute',
    left: 0,
    minWidth: 44,
    height: 44,
    paddingLeft: 4,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    zIndex: 1,
  },
  backText: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.muted,
  },
  accountClose: {
    position: 'absolute',
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    zIndex: 1,
  },
  headerControlPressed: { backgroundColor: t.colors.surfaces.s300 },
  stickyTitle: {
    position: 'absolute',
    top: 20,
    left: 76,
    right: 76,
    height: 44,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 44,
    fontWeight: t.fontWeights.bold,
    textAlign: 'center',
    color: t.colors.text.primary,
  },
  accountSheetBody: { paddingTop: 0, paddingHorizontal: 22, paddingBottom: 26 },
  accountCardBody: { paddingTop: 0, paddingHorizontal: 20, paddingBottom: 26 },
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
  accountIconSlot: { marginBottom: 14 },
  title: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    lineHeight: 32,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  titleSheet: { fontSize: 23, lineHeight: 30 },
  accountHeading: { marginTop: accountPanelHeaderContentGap },
  accountTitle: {
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.48,
  },
  descriptionWrap: { marginTop: 9 },
  accountDescriptionWrap: { marginTop: 6 },
  description: descriptionTextStyle,
  children: { marginTop: 22 },
});
