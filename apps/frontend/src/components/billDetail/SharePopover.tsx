import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { MobileShareSheet } from '../share/MobileShareSheet';
import { useResponsive } from '../../hooks/useResponsive';
import { placeAnchoredPanel, type AnchorRect } from '../../lib/anchoredPanel';
import { buildShareIntents, type ShareContent } from '../../lib/share';
import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Bill Detail's Share control, lifted out of BillHeader so the Ask answer page
// uses the SAME button and popover rather than a lookalike (grounded-ask-spec
// §9.5 decision 10 — "Bill Detail's exact button and popover"). Page-specific
// text arrives as one ShareContent value, while this component owns the layout
// and platform buttons.
//
// LAYERING, and why the panel is a Modal rather than a box inside the page.
//
// A panel drawn inside the article has been painted over three times on this
// stack: the Legislator Profile session filter, the Bill Search "Sorted by"
// menu, and this Share panel on the campaign-money report page, where the
// article covered it and it also ran off the bottom of the window. Raising its
// own z-index cannot fix that, and the reason is structural: react-native-web
// gives EVERY View `position: relative; z-index: 0`, so a panel nested in the
// article shares a layer with each of the article's
// later blocks and loses to them on document order however high it climbs
// inside its own parent. The article also scrolls inside a ScrollView that both
// clips its overflow and carries a transform, and a transform makes an ancestor
// the containing block for `position: fixed` too, so even a fixed panel would be
// trapped and cut off.
//
// So the panel is rendered in a react-native Modal, which on web is a portal into
// document.body holding a fixed, full-window layer at z-index 9999 (the highest
// z-index anywhere else in this app is 80). That single move satisfies the whole
// contract: nothing in the page can paint over it, no ancestor can clip it, it
// adds nothing to the article's layout so nothing behind it moves, and the Modal
// itself supplies Escape-to-close and a focus trap that hands focus back to the
// Share control on close. What this file still owns is where the panel sits
// inside that layer (lib/anchoredPanel.ts) and closing on an outside click.

export function SharePopover({ content }: { content: ShareContent }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const { isDesktop } = useResponsive();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareBtnRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const closeBtnRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [panelSize, setPanelSize] = useState<{ height: number; width: number } | null>(null);

  const measure = useCallback(() => {
    measureBox(shareBtnRef.current, setAnchor);
    measureBox(panelRef.current, (box) =>
      setPanelSize({ height: box.bottom - box.top, width: box.right - box.left }),
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Measure the Share control and the panel every time the panel opens and every
  // time the window changes size, so the panel is placed against where the
  // control actually is rather than where it was. This runs before the browser
  // paints, so on the web the panel is never drawn in the wrong place first.
  useLayoutEffect(() => {
    if (!open || !isDesktop) {
      setAnchor(null);
      return;
    }
    measure();
  }, [isDesktop, measure, open, windowHeight, windowWidth]);

  // Send the keyboard to the panel's Close button on open. The Modal's own focus
  // trap keeps focus inside from there and returns it to the Share control on
  // close, but it would otherwise land on whichever element happens to come
  // first, which is the invisible backdrop.
  useEffect(() => {
    if (!isWeb || !open || !isDesktop) return;
    (closeBtnRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [isDesktop, open]);

  const intents = buildShareIntents(content);
  const { description, previewDescription, subject, title, url } = content;

  const placement =
    anchor && panelSize
      ? placeAnchoredPanel({
          anchor,
          panel: panelSize,
          viewport: { height: windowHeight, width: windowWidth },
        })
      : null;

  const copy = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1900);
  };

  const openIntent = (href: string) => {
    if (isWeb && typeof window !== 'undefined') {
      window.open(href, '_blank', 'noopener');
    } else {
      Linking.openURL(href).catch(() => {});
    }
  };

  return (
    <View style={styles.shareWrap}>
      <Pressable
        ref={shareBtnRef}
        accessibilityRole="button"
        accessibilityLabel={`Share this ${subject}`}
        aria-expanded={open}
        onPress={() => {
          setOpen((v) => !v);
          setCopied(false);
        }}
        {...btnHover}
        style={[styles.shareBtn, btnHovered && styles.shareBtnHover]}
      >
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
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
          visible={open}
          transparent
          animationType="none"
          onRequestClose={() => setOpen(false)}
        >
          {/* Transparent full-window backdrop: closes on an outside click, and
              takes itself out of the tab order (react-native-web makes every
              Pressable a tab stop unless tabIndex says otherwise) so the keyboard
              cycles inside the panel instead of landing on an invisible sheet. */}
          <Pressable
            accessibilityLabel="Close share"
            tabIndex={-1}
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <View
            accessibilityRole={isWeb ? undefined : 'menu'}
            aria-label={`Share this ${subject}`}
            ref={panelRef}
            style={[
              styles.sharePanel,
              isWeb ? (styles.sharePanelWeb as object) : null,
              placement ? { left: placement.left, top: placement.top } : styles.sharePanelUnplaced,
            ]}
          >
            <View style={styles.sharePanelHead}>
              <Text style={styles.sharePanelTitle}>{`Share this ${subject}`}</Text>
              <Pressable
                ref={closeBtnRef}
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                style={styles.shareClose}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M6 6 L18 18 M18 6 L6 18"
                    stroke={t.colors.text.muted}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            </View>

            <View style={styles.sharePreview}>
              <Text numberOfLines={2} style={styles.sharePreviewTitle}>
                {title}
              </Text>
              <Text numberOfLines={3} style={styles.sharePreviewDescription}>
                {previewDescription ?? description}
              </Text>
            </View>

            <View style={styles.shareUrlRow}>
              <TextInput
                value={url}
                editable={false}
                accessibilityLabel={`${subject.charAt(0).toUpperCase()}${subject.slice(1)} link`}
                style={[styles.shareUrlInput, isWeb ? ({ outlineStyle: 'none' } as object) : null]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={copy}
                style={[styles.shareCopyBtn, copied && styles.shareCopyBtnCopied]}
              >
                {copied ? (
                  <>
                    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M5 12.5 L10 17.5 L19 7"
                        stroke={t.colors.text.onGreen}
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                    <Text style={styles.shareCopyText}>Copied</Text>
                  </>
                ) : (
                  <Text style={styles.shareCopyText}>Copy</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.shareSocialSection}>
              <Text style={styles.shareSocialLabel}>SHARE TO</Text>
              <View style={styles.shareSocialRow}>
                <SocialButton
                  label="Share on LinkedIn"
                  onPress={() => openIntent(intents.linkedin)}
                >
                  <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </SocialButton>
                <SocialButton label="Share on X" onPress={() => openIntent(intents.x)}>
                  <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </SocialButton>
                <SocialButton
                  label="Share on Facebook"
                  onPress={() => openIntent(intents.facebook)}
                >
                  <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
                </SocialButton>
                <SocialButton
                  label="Share by email"
                  onPress={() => openIntent(intents.email)}
                  stroke
                >
                  <Path
                    d="M3 6.5 h18 v11 h-18 Z M4 7.5 L12 13 L20 7.5"
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </SocialButton>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// Where something sits in the window, which is the coordinate space the panel is
// painted in. `getBoundingClientRect` is exact and synchronous on the web, the
// platform this ships on, so the answer is ready before the browser paints;
// native has no such call and falls back to React Native's own measurement,
// which answers a moment later, with the panel held invisible until it does.
function measureBox(node: View | null, apply: (box: AnchorRect) => void) {
  if (!node) return;
  if (isWeb) {
    const { bottom, left, right, top } = (node as unknown as HTMLElement).getBoundingClientRect();
    apply({ bottom, left, right, top });
    return;
  }
  node.measureInWindow((x, y, width, height) =>
    apply({ bottom: y + height, left: x, right: x + width, top: y }),
  );
}

function SocialButton({
  label,
  onPress,
  children,
  stroke,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  stroke?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hover}
      style={[styles.social, hovered && styles.socialHover]}
    >
      <Svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill={stroke ? 'none' : t.colors.text.primary}
      >
        {children}
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The panel no longer sits inside this wrapper, so this layer is only about
  // the Share button holding its place among its own neighbours on the pages
  // that use it. Left exactly as it was, because changing it would change those
  // pages rather than this panel.
  shareWrap: {
    position: 'relative',
    zIndex: 60,
    marginBottom: 10,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    // Leading share glyph, so 3px less on the left (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 17,
    paddingRight: 20,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
  },
  shareBtnHover: {
    borderColor: t.colors.alpha.ink32,
    backgroundColor: t.colors.surfaces.s200,
  },
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
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    ...(t.shadows.lg as object),
  },
  sharePanelWeb: { boxShadow: '0 24px 60px rgba(17,21,15,0.2)' },
  // Held invisible until the panel has been measured, so it is never seen in the
  // top-left corner on its way to the Share control. On the web the measurement
  // happens before the browser paints, so this state is never drawn at all; on
  // native, where measuring answers a moment later, it covers that moment.
  sharePanelUnplaced: { opacity: 0 },
  sharePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sharePanelTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  sharePreview: {
    marginTop: 12,
  },
  sharePreviewTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  sharePreviewDescription: {
    marginTop: 5,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  shareClose: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.sm,
  },
  shareUrlRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 14,
  },
  shareUrlInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.secondary,
  },
  shareCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  // Copied state adds a leading checkmark glyph, so 3px less on the left
  // (docs/design/design-principles.md §2, Optical centering). The plain "Copy"
  // text state has no icon, so the base style stays untrimmed for it.
  shareCopyBtnCopied: { paddingLeft: 13 },
  shareCopyText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  shareSocialSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  shareSocialLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  shareSocialRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  social: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialHover: {
    backgroundColor: '#e7e8ec',
  },
});
