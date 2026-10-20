import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { MobileShareSheet } from '../share/MobileShareSheet';
import { SharePanelContent } from '../share/SharePanelContent';
import { useResponsive } from '../../hooks/useResponsive';
import { PANEL_EDGE_MARGIN, placeAnchoredPanel, type AnchorRect } from '../../lib/anchoredPanel';
import { shareDialogLabel, type ShareContent } from '../../lib/share';
import { theme as t } from '../../theme/tokens';
import { isWeb, useHover, useFineHover } from './interactions';

// Keep the existing page triggers and supplied content. The portal escapes page
// stacking contexts and ScrollViews; Modal owns Escape, focus trapping/restoration.
export function SharePopover({
  content,
  compact = false,
  disabled = false,
  article = false,
}: {
  content: ShareContent;
  compact?: boolean;
  disabled?: boolean;
  article?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const [articleHovered, articleHover] = useFineHover();
  const { isDesktop } = useResponsive();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const shareBtnRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const headingRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [panelSize, setPanelSize] = useState<{ height: number; width: number } | null>(null);

  const measure = useCallback(() => {
    measureBox(shareBtnRef.current, setAnchor);
    measureBox(panelRef.current, (box) =>
      setPanelSize({ height: box.bottom - box.top, width: box.right - box.left }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open || !isDesktop) {
      setAnchor(null);
      return;
    }
    measure();
  }, [isDesktop, measure, open, windowHeight, windowWidth]);

  useEffect(() => {
    if (!open || !isDesktop || !isWeb) return;
    window.addEventListener('scroll', measure, true);
    return () => window.removeEventListener('scroll', measure, true);
  }, [open, isDesktop, measure]);

  const restoreFocus = () => {
    if (isWeb)
      (shareBtnRef.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: true });
  };

  const placement =
    anchor && panelSize
      ? placeAnchoredPanel({
          anchor,
          panel: panelSize,
          viewport: { height: windowHeight, width: windowWidth },
        })
      : null;

  return (
    <View style={[styles.shareWrap, (compact || article) && styles.shareWrapCompact]}>
      <Pressable
        disabled={disabled}
        accessibilityState={{ disabled }}
        ref={shareBtnRef}
        accessibilityRole="button"
        accessibilityLabel={shareDialogLabel(content.subject, content.resultsKind)}
        aria-expanded={open}
        aria-haspopup="dialog"
        onPress={() => setOpen((value) => !value)}
        {...(!disabled ? (article ? articleHover : btnHover) : {})}
        style={({ pressed }) => [
          styles.shareBtn,
          disabled && { opacity: 0.5 },
          compact && styles.shareBtnCompact,
          !article && btnHovered && styles.shareBtnHover,
          compact && btnHovered && styles.shareBtnCompactHover,
          article && styles.shareBtnArticle,
          article && (articleHovered || open) && styles.shareBtnArticleHover,
          article && pressed && styles.shareBtnArticlePressed,
        ]}
      >
        <Svg
          width={article ? 16 : 17}
          height={article ? 16 : 17}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <Circle
            cx={18}
            cy={5}
            r={article ? 2.8 : 2.6}
            stroke={t.colors.text.primary}
            strokeWidth={2}
          />
          <Circle
            cx={6}
            cy={12}
            r={article ? 2.8 : 2.6}
            stroke={t.colors.text.primary}
            strokeWidth={2}
          />
          <Circle
            cx={18}
            cy={19}
            r={article ? 2.8 : 2.6}
            stroke={t.colors.text.primary}
            strokeWidth={2}
          />
          <Path
            d={
              article
                ? 'M8.5 10.8 L15.5 6.4 M8.5 13.2 L15.5 17.6'
                : 'M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5'
            }
            stroke={t.colors.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <Text
          style={[
            styles.shareBtnText,
            compact && styles.shareBtnTextCompact,
            article && styles.shareBtnTextArticle,
          ]}
        >
          Share
        </Text>
      </Pressable>
      {!isDesktop ? (
        <MobileShareSheet
          visible={open}
          onClose={() => setOpen(false)}
          onDismiss={restoreFocus}
          content={content}
        />
      ) : (
        <Modal
          aria-label={shareDialogLabel(content.subject, content.resultsKind)}
          visible={open}
          transparent
          animationType="none"
          onRequestClose={() => setOpen(false)}
          onDismiss={restoreFocus}
          onShow={() => {
            measure();
            if (isWeb) (headingRef.current as unknown as HTMLElement | null)?.focus?.();
          }}
        >
          <Pressable
            accessibilityLabel="Close share"
            tabIndex={-1}
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <View
            ref={panelRef}
            aria-label={shareDialogLabel(content.subject, content.resultsKind)}
            onLayout={measure}
            style={[
              styles.sharePanel,
              { maxHeight: Math.max(0, windowHeight - PANEL_EDGE_MARGIN * 2) },
              isWeb && (styles.sharePanelWeb as object),
              placement ? { left: placement.left, top: placement.top } : styles.sharePanelUnplaced,
            ]}
          >
            {open ? (
              <SharePanelContent
                content={content}
                variant="desktop"
                onClose={() => setOpen(false)}
                headingRef={headingRef}
              />
            ) : null}
          </View>
        </Modal>
      )}
    </View>
  );
}

function measureBox(node: View | null, apply: (box: AnchorRect) => void) {
  if (!node) return;
  if (isWeb) {
    const { bottom, left, right, top } = (node as unknown as HTMLElement).getBoundingClientRect();
    apply({ bottom, left, right, top });
  } else
    node.measureInWindow((x, y, width, height) =>
      apply({ bottom: y + height, left: x, right: x + width, top: y }),
    );
}

const styles = StyleSheet.create({
  shareWrap: { position: 'relative', zIndex: 60, marginBottom: 10 },
  shareWrapCompact: { marginBottom: 0 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 17,
    paddingRight: 20,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
  },
  shareBtnHover: { borderColor: t.colors.alpha.ink32, backgroundColor: t.colors.surfaces.s200 },
  shareBtnCompact: {
    minHeight: 44,
    gap: 9,
    paddingVertical: 0,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  shareBtnCompactHover: { backgroundColor: t.colors.surfaces.base },
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  shareBtnArticle: {
    minHeight: 44,
    gap: 9,
    paddingVertical: 10,
    paddingLeft: 15,
    paddingRight: 18,
    borderRadius: 11,
  },
  shareBtnArticleHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  shareBtnArticlePressed: { backgroundColor: '#f1f1f4', borderColor: 'rgba(17,21,15,0.3)' },
  shareBtnTextArticle: { fontSize: 15, lineHeight: 19.5, fontWeight: '700', color: '#2c322c' },
  shareBtnTextCompact: { fontSize: 15.5, fontWeight: '700' },
  sharePanel: {
    position: 'absolute',
    width: 366,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.xl,
    overflow: 'hidden',
    ...(t.shadows.lg as object),
  },
  sharePanelWeb: { boxShadow: '0 24px 60px rgba(17,21,15,0.2)' },
  sharePanelUnplaced: { opacity: 0 },
});
