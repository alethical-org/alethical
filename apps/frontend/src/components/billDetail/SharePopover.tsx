import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { MobileShareSheet } from '../share/MobileShareSheet';
import { SharePanelContent } from '../share/SharePanelContent';
import { useResponsive } from '../../hooks/useResponsive';
import { PANEL_EDGE_MARGIN, placeAnchoredPanel, type AnchorRect } from '../../lib/anchoredPanel';
import { shareDialogLabel, type ShareContent } from '../../lib/share';
import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Keep the existing page triggers and supplied content. The portal escapes page
// stacking contexts and ScrollViews; Modal owns Escape, focus trapping/restoration.
export function SharePopover({ content }: { content: ShareContent }) {
  const [open, setOpen] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const { isDesktop } = useResponsive();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const shareBtnRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const closeButtonRef = useRef<View>(null);
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

  const placement =
    anchor && panelSize
      ? placeAnchoredPanel({
          anchor,
          panel: panelSize,
          viewport: { height: windowHeight, width: windowWidth },
        })
      : null;

  return (
    <View style={styles.shareWrap}>
      <Pressable
        ref={shareBtnRef}
        accessibilityRole="button"
        accessibilityLabel={shareDialogLabel(content.subject, content.resultsKind)}
        aria-expanded={open}
        aria-haspopup="dialog"
        onPress={() => setOpen((value) => !value)}
        {...btnHover}
        style={[styles.shareBtn, btnHovered && styles.shareBtnHover]}
      >
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Circle cx={18} cy={5} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={6} cy={12} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={18} cy={19} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Path
            d="M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5"
            stroke={t.colors.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <Text style={styles.shareBtnText}>Share</Text>
      </Pressable>
      {!isDesktop ? (
        <MobileShareSheet visible={open} onClose={() => setOpen(false)} content={content} />
      ) : (
        <Modal
          aria-label={shareDialogLabel(content.subject, content.resultsKind)}
          visible={open}
          transparent
          animationType="none"
          onRequestClose={() => setOpen(false)}
          onShow={() => {
            measure();
            if (isWeb) (closeButtonRef.current as unknown as HTMLElement | null)?.focus?.();
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
                closeButtonRef={closeButtonRef}
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
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
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
