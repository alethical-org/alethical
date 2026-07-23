import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { useResponsive } from '../../hooks/useResponsive';
import { isWeb, useHover } from './interactions';

export type DetailTab = 'summary' | 'actions' | 'votes' | 'versions' | 'fulltext';

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'summary', label: 'Summary' },
  { key: 'actions', label: 'Actions' },
  { key: 'votes', label: 'Votes' },
  { key: 'versions', label: 'Versions' },
  { key: 'fulltext', label: 'Full Text' },
];

// Bill header — stable across tabs (spec §Header — title-first). H1 title (hero) +
// one eyebrow line (session + optional OMNIBUS), then the tab bar with a Share
// button at its right end opening an anchored popover.
export function BillHeader({
  title,
  fullTitle,
  eyebrow,
  omnibus,
  shareUrl,
  shareTitle,
  activeTab,
  onSelectTab,
  onAllBills,
}: {
  title: string;
  // Full official statutory title ("A bill for an act relating to…"). The H1 shows
  // the concise plain-language `title`; the statutory text stays one hover away.
  fullTitle: string;
  eyebrow: string;
  omnibus: boolean;
  shareUrl: string;
  shareTitle: string;
  activeTab: DetailTab;
  onSelectTab: (tab: DetailTab) => void;
  onAllBills: () => void;
}) {
  const { isMobile } = useResponsive();
  // Keep the authoritative statutory title reachable as a hover tooltip on web.
  // RN-Web doesn't forward the DOM `title` attribute, so set it on the host node.
  const headingRef = useRef<any>(null);
  useEffect(() => {
    const node = headingRef.current;
    if (isWeb && node && typeof node.setAttribute === 'function') {
      node.setAttribute('title', fullTitle);
    }
  }, [fullTitle]);
  return (
    <View>
      <Breadcrumb onPress={onAllBills} isMobile={isMobile} />
      <Text
        ref={headingRef}
        accessibilityRole="header"
        accessibilityLabel={fullTitle}
        style={[styles.h1, isMobile && styles.h1Mobile]}
      >
        {title}
      </Text>
      <View style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {omnibus ? <OmnibusTag /> : null}
      </View>

      <View style={[styles.tabBar, isMobile && styles.tabBarMobile]}>
        <View style={[styles.tabList, isMobile && styles.tabListMobile]}>
          {TABS.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={tab.key === activeTab}
              onPress={() => onSelectTab(tab.key)}
            />
          ))}
        </View>
        <SharePopover url={shareUrl} title={shareTitle} />
      </View>
    </View>
  );
}

// "‹ All bills" back-link — first element in the header, above the title. Whole
// link darkens from grey to ink on hover. Links back to the Search Bills screen.
function Breadcrumb({ onPress, isMobile }: { onPress: () => void; isMobile: boolean }) {
  const [hovered, hover] = useHover();
  const color = hovered ? t.colors.ink : BREADCRUMB_GREY;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="All bills"
      onPress={onPress}
      {...hover}
      style={styles.breadcrumb}
    >
      <Svg width={isMobile ? 17 : 18} height={isMobile ? 17 : 18} viewBox="0 0 24 24" fill="none">
        <Path
          d="M15 6 L9 12 L15 18"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={[styles.breadcrumbLabel, isMobile && styles.breadcrumbLabelMobile, { color }]}>
        All bills
      </Text>
    </Pressable>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} tab`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...hover}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text
        style={[
          styles.tabLabel,
          active ? styles.tabLabelActive : hovered ? styles.tabLabelHover : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OmnibusTag() {
  return (
    <View style={styles.omnibus} accessibilityRole="text" accessibilityLabel="Omnibus bill">
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 4 v16 M6 8 h12 M7 8 l-3 6 h6 Z M17 8 l-3 6 h6 Z"
          stroke={t.colors.omnibus.text}
          strokeWidth={1.9}
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.omnibusText}>OMNIBUS</Text>
    </View>
  );
}

// --- Share (copy link + social), anchored popover (spec §Share) ---
function SharePopover({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const enc = encodeURIComponent;
  const intents = {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(`${title} · Alethical`)}&url=${enc(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    instagram: 'https://www.instagram.com/',
    email: `mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}\n\nvia Alethical`)}`,
  };

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
        accessibilityRole="button"
        accessibilityLabel="Share this bill"
        accessibilityState={{ expanded: open }}
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

      {open ? (
        <>
          {/* transparent backdrop closes on outside click */}
          <Pressable
            accessibilityLabel="Close share"
            style={styles.shareBackdrop}
            onPress={() => setOpen(false)}
          />
          <View
            accessibilityRole={isWeb ? undefined : 'menu'}
            style={[styles.sharePanel, isWeb ? (styles.sharePanelWeb as object) : null]}
          >
            <View style={styles.sharePanelHead}>
              <Text style={styles.sharePanelTitle}>Share this bill</Text>
              <Pressable
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

            <View style={styles.shareUrlRow}>
              <TextInput
                value={url}
                editable={false}
                accessibilityLabel="Bill link"
                style={[styles.shareUrlInput, isWeb ? ({ outlineStyle: 'none' } as object) : null]}
              />
              <Pressable accessibilityRole="button" onPress={copy} style={styles.shareCopyBtn}>
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
                  label="Share on Instagram"
                  onPress={() => openIntent(intents.instagram)}
                >
                  <Path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-10.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
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
        </>
      ) : null}
    </View>
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

// Breadcrumb grey (palette.ink500) — no semantic text alias maps to it, so it's a
// local const like the other bespoke header colors.
const BREADCRUMB_GREY = '#4b524b';

const styles = StyleSheet.create({
  // ~8px added on top of SearchPageShell's 36px hero paddingTop → ~44px from the
  // nav to the breadcrumb, and ~20px down to the title.
  breadcrumb: {
    marginTop: 8,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  breadcrumbLabel: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  breadcrumbLabelMobile: { fontSize: 15 },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 45,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.9,
    color: t.colors.text.primary,
  },
  // Narrow widths: scale the hero title down so a long statutory title doesn't
  // swamp a phone viewport (the desktop 42px wraps to ~13 lines at 375px).
  h1Mobile: { fontSize: 28, lineHeight: 32, letterSpacing: -0.4 },
  eyebrowRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  omnibus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.omnibus.ghostBorder,
    borderRadius: t.radii.sm,
  },
  omnibusText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.omnibus.text,
  },
  tabBar: {
    marginTop: 30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink10,
  },
  // Narrow: let Share wrap below the tabs and tighten the tab spacing so all four
  // tabs stay reachable within the phone-width column (no clipped 4th tab).
  tabBarMobile: { marginTop: 22, rowGap: 4 },
  tabList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 34,
    flexWrap: 'wrap',
  },
  tabListMobile: { gap: 22, flex: 1, minWidth: 240 },
  tab: {
    paddingHorizontal: 2,
    paddingBottom: 14,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: t.colors.brand.base,
  },
  tabLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  tabLabelActive: {
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  tabLabelHover: {
    color: t.colors.text.primary,
  },
  // --- Share ---
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
    paddingHorizontal: 20,
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
  shareBackdrop: {
    ...(StyleSheet.absoluteFillObject as object),
    position: (isWeb ? 'fixed' : 'absolute') as 'absolute',
    top: -2000,
    left: -2000,
    right: -2000,
    bottom: -2000,
    zIndex: 0,
  },
  sharePanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 12,
    zIndex: 1,
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
