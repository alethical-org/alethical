import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { ChevronDown, ChevronUp, MapPin, Menu, Plus, X } from 'lucide-react-native';

import { theme } from './tokens';
import { IaItem, MenuKey, MENUS, navDropdownItems } from '../navigation/ia';
import { useResponsive } from '../hooks/useResponsive';

// Reusable primitives for the redesign, built on the green token system
// (see theme/tokens.ts, extracted from docs/mockups/*.html). Web-first.

const isWeb = Platform.OS === 'web';
const t = theme;

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

// --- Page background: gradient + green wash, with a masked dot-grid that fades
//     in/out vertically (matches the subtle fade in the mockups). ---
export function PageBackground({
  children,
  variant = 'page',
}: {
  children: ReactNode;
  variant?: 'page' | 'pageGreen';
}) {
  const baseWeb = isWeb
    ? ({
        backgroundColor: t.colors.surfaces.s200,
        backgroundImage: variant === 'pageGreen' ? t.gradients.pageGreen : t.gradients.page,
      } as unknown as ViewStyle)
    : { backgroundColor: t.colors.surfaces.s200 };
  // Dots are drawn page-relative inside the scroll content (see PageDots), not here,
  // so they scroll with the page and fade near the top and bottom like the mockup.
  return <View style={[styles.pageBg, baseWeb]}>{children}</View>;
}

// Page-relative dot grid: place as the first child of the scroll content (which
// must be position: relative). Scrolls with the page and fades near the top and
// just above the footer, so the white cards below sit on plainer background.
export function PageDots() {
  if (!isWeb) {
    return null;
  }
  const mask =
    'linear-gradient(to bottom, transparent 0px, transparent 150px, #000 280px, #000 calc(100% - 180px), transparent 100%)';
  const dots: any = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: 'radial-gradient(rgba(17,21,15,0.07) 1.4px, transparent 1.5px)',
    backgroundSize: '30px 30px',
    maskImage: mask,
    WebkitMaskImage: mask,
  };
  return <View pointerEvents="none" style={dots} />;
}

export function Container({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.container, isMobile && styles.containerMobile, style]}>{children}</View>
  );
}

export function MetaStripe({
  left,
  right,
  rightMobile,
}: {
  left: string;
  right: string;
  rightMobile?: string;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.metaStripe, isMobile && styles.metaStripeMobile]}>
      <Text style={styles.metaText}>{left}</Text>
      <Text style={styles.metaText}>{isMobile ? (rightMobile ?? right) : right}</Text>
    </View>
  );
}

// --- Brand logo: twin-peak mark (two sharp triangles) + the ALETHICAL wordmark
//     as live Space Grotesk text (weight 500, letter-spacing 0.16em, vertically
//     centered on the mark) — matching the brand lockup SVG. `variant`: 'nav'
//     renders mark + wordmark in the top bar (a touch smaller on phones so the
//     wordmark still fits beside Sign in + menu); 'menu' renders the mark alone
//     for the drawer header. tone sets the fill for dark vs light surfaces. ---
const MARK_ASPECT = 84 / 82; // near-square twin-peak mark
const MARK_PATH = 'M0 82 L38 0 L38 82 Z M84 82 L46 0 L46 82 Z';

function LogoMark({ height, fill }: { height: number; fill: string }) {
  return (
    <Svg width={height * MARK_ASPECT} height={height} viewBox="0 0 84 82" fill="none">
      <Path d={MARK_PATH} fill={fill} />
    </Svg>
  );
}

export function Logo({
  tone = 'dark',
  variant = 'nav',
}: {
  tone?: 'dark' | 'light';
  variant?: 'nav' | 'menu';
}) {
  const { isMobile, isDesktop } = useResponsive();
  const light = tone === 'light';
  const fill = light ? t.colors.white : t.colors.ink;

  // Drawer header: mark alone.
  if (variant === 'menu') {
    return (
      <View accessibilityRole="image" accessibilityLabel="Alethical">
        <LogoMark height={30} fill={fill} />
      </View>
    );
  }

  // Top bar: mark + wordmark, sized per context:
  //  - phone (<768): scaled down so the full wordmark fits beside Sign in + menu.
  //  - desktop (>=1100): a touch smaller than tablet, since here the wordmark sits
  //    beside the 18px inline nav links and full-size reads oversized next to them.
  //  - tablet (768-1099): full size (inline links are collapsed into the menu).
  const markH = isMobile ? 22 : isDesktop ? 30 : 34;
  const fontSize = isMobile ? 20 : isDesktop ? 26 : 30;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: Math.round(markH * 0.4) }}
      accessibilityRole="image"
      accessibilityLabel="Alethical"
    >
      <LogoMark height={markH} fill={fill} />
      <Text
        style={{
          fontFamily: t.typography.wordmark,
          fontWeight: '500',
          fontSize,
          lineHeight: fontSize,
          letterSpacing: fontSize * 0.16,
          color: fill,
        }}
      >
        ALETHICAL
      </Text>
    </View>
  );
}

// --- v2 nav dropdowns (docs/mockups/home-signed-out-v2) ---

/** Sparkle glyph — the AI affordance (ASKED eyebrow, Grounded Ask pill, ✦ Ask entry). */
export function Sparkle({
  size = 11,
  color = t.colors.purple.base,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5 L13.9 9.4 L21 12 L13.9 14.6 L12 21.5 L10.1 14.6 L3 12 L10.1 9.4 Z"
        fill={color}
      />
    </Svg>
  );
}

/** Dropdown-row icon tiles — inline SVGs lifted from the DC source. */
function MenuRowIcon({ itemId, disabled }: { itemId: string; disabled?: boolean }) {
  const c = disabled ? '#a4aba5' : t.colors.brand.deep;
  return (
    <View style={[styles.menuRowIconTile, disabled && styles.menuRowIconTileDisabled]}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        {itemId === 'search-bills' || itemId === 'track-bills' ? (
          <>
            <Path
              d="M8 3h6l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
              stroke={c}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Path
              d="M14 3v4h4M10 12h5M10 16h4"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}
        {itemId === 'search-legislators' ||
        itemId === 'track-legislators' ||
        itemId === 'search-candidates' ||
        itemId === 'track-candidates' ? (
          <>
            <Circle cx={12} cy={8} r={3.4} stroke={c} strokeWidth={2} />
            <Path
              d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        ) : null}
        {itemId === 'search-find-my-legislator' ? (
          <>
            <Path
              d="M12 21 C 12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C 19 14.5 12 21 12 21 Z"
              stroke={c}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Circle cx={12} cy={9.5} r={2.4} stroke={c} strokeWidth={2} />
          </>
        ) : null}
        {itemId === 'search-issues' || itemId === 'track-issues' ? (
          <>
            <Path
              d="M4 13l7-7a2 2 0 0 1 1.4-.6H18a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4l-7 7a2 2 0 0 1-2.8 0l-5.6-5.6a2 2 0 0 1 0-2.8Z"
              stroke={c}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Circle cx={15.5} cy={8.5} r={1.3} fill={c} />
          </>
        ) : null}
        {itemId === 'about-us' ? (
          <>
            <Circle cx={9.5} cy={8} r={3.2} stroke={c} strokeWidth={2} />
            <Path
              d="M3.5 19.5c0-3.3 2.7-6 6-6s6 2.7 6 6"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <Path
              d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <Path d="M18 13.9c2.4.5 4 2.7 4 5.6" stroke={c} strokeWidth={2} strokeLinecap="round" />
          </>
        ) : null}
        {itemId === 'about-contact' ? (
          <>
            <Rect x={3.5} y={5.5} width={17} height={13} rx={2} stroke={c} strokeWidth={2} />
            <Path
              d="M4.5 7l7.5 5.5L19.5 7"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/** Web-only ~0.15s ease fade for the dropdown row hover highlight (no-op on native). */
const rowHoverTransition = isWeb
  ? ({
      transitionProperty: 'background-color',
      transitionDuration: '0.15s',
      transitionTimingFunction: 'ease',
    } as object)
  : null;

function MenuPanelRow({ item, onPress }: { item: IaItem; onPress?: (item: IaItem) => void }) {
  const [hovered, hoverProps] = useHover();
  const disabled = item.availability === 'roadmap';
  const body = (
    <>
      <MenuRowIcon itemId={item.id} disabled={disabled} />
      <View style={styles.menuRowBody}>
        <View style={styles.menuRowTitleRow}>
          <Text style={[styles.menuRowTitle, disabled && styles.menuRowTitleDisabled]}>
            {item.label}
          </Text>
        </View>
        {item.description ? (
          <Text style={[styles.menuRowDesc, disabled && styles.menuRowDescDisabled]}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (disabled) {
    return <View style={styles.menuPanelRow}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => onPress?.(item)}
      {...hoverProps}
      style={[styles.menuPanelRow, rowHoverTransition, hovered && styles.menuPanelRowHover]}
    >
      {body}
    </Pressable>
  );
}

/** Muted, non-interactive "coming soon" pill for the ON THE ROADMAP group. `large` = mobile size. */
function RoadmapPill({ label, large }: { label: string; large?: boolean }) {
  return (
    <View style={[styles.roadmapPill, large && styles.roadmapPillLarge]}>
      <Text style={[styles.roadmapPillText, large && styles.roadmapPillTextLarge]}>{label}</Text>
    </View>
  );
}

const PANEL_WIDTHS: Partial<Record<MenuKey, number>> = { search: 452, track: 452, about: 320 };

function MenuPanel({ menu, onNavigate }: { menu: MenuKey; onNavigate?: (item: IaItem) => void }) {
  const { live, roadmap } = navDropdownItems(menu);
  const width = PANEL_WIDTHS[menu] ?? 452;
  return (
    <View style={[styles.menuPanel, { width }, t.shadows.panel as ViewStyle]}>
      <View style={[styles.menuPanelNotch, { left: width / 2 - 7.5 }]} />
      <View style={styles.menuPanelList}>
        {live.map((item) => (
          <MenuPanelRow key={item.id} item={item} onPress={onNavigate} />
        ))}
        {roadmap.length > 0 ? (
          <>
            <View style={styles.roadmapLabelRow}>
              <Text style={styles.roadmapLabel}>ON THE ROADMAP</Text>
              <View style={styles.roadmapRule} />
            </View>
            <View style={styles.roadmapPillRow}>
              {roadmap.map((item) => (
                <RoadmapPill key={item.id} label={item.label} />
              ))}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function NavDropdownTrigger({
  menu,
  label,
  open,
  onToggle,
  onNavigate,
}: {
  menu: MenuKey;
  label: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: (item: IaItem) => void;
}) {
  const [hovered, hoverProps] = useHover();
  const [triggerLayout, setTriggerLayout] = useState({ width: 0, height: 0 });
  const width = PANEL_WIDTHS[menu] ?? 452;
  const color = open ? t.colors.brand.deep : hovered ? t.colors.text.primary : '#4b524b';
  const Caret = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.navTriggerWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        {...hoverProps}
        onLayout={(e) => setTriggerLayout(e.nativeEvent.layout)}
        style={styles.navTrigger}
      >
        <Text style={[styles.navTriggerText, { color }]}>{label}</Text>
        <Caret size={14} color={color} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <View
          style={[
            styles.menuPanelAnchor,
            {
              top: triggerLayout.height + 30,
              left: triggerLayout.width / 2 - width / 2,
            },
          ]}
        >
          <MenuPanel menu={menu} onNavigate={onNavigate} />
        </View>
      ) : null}
    </View>
  );
}

/** Purple top-level "✦ Ask" entry — non-home pages only (page-aware nav, O10). */
function AskNavEntry({ onPress }: { onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hoverProps} style={styles.navTrigger}>
      <Sparkle size={14} />
      <Text
        style={[
          styles.navTriggerText,
          { color: t.colors.purple.base },
          hovered && { textDecorationLine: 'underline' },
        ]}
      >
        Ask
      </Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  size = 'md',
}: {
  label: string;
  onPress?: () => void;
  size?: 'md' | 'lg';
}) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.primaryBtn,
        size === 'lg' && styles.primaryBtnLg,
        { backgroundColor: hovered ? t.colors.brand.hover : t.colors.brand.base },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={[styles.primaryBtnText, size === 'lg' && styles.primaryBtnTextLg]}>{label}</Text>
    </Pressable>
  );
}

// --- Top navigation: v2 dropdowns on desktop, drawer on mobile. PAGE-AWARE
//     (O10): `variant="home"` hides the ✦ Ask entry (the hero is the ask
//     surface); `variant="page"` restores it top-level. Dropdown state can be
//     controlled by the host screen (it drives the answer-card blur overlay).
//     Outside-click close is handled here on web via a document listener — NOT a
//     full-screen overlay, which stacked above the panel and swallowed row
//     hover/clicks. Rows render from the ia.ts registry. ---
export type NavVariant = 'home' | 'page';

export function TopNav({
  variant = 'home',
  openMenu: openMenuProp,
  onOpenMenuChange,
  onNavigate,
  onHome,
  onSignIn,
  onAsk,
}: {
  variant?: NavVariant;
  openMenu?: MenuKey | null;
  onOpenMenuChange?: (menu: MenuKey | null) => void;
  onNavigate?: (item: IaItem) => void;
  onHome?: () => void;
  onSignIn?: () => void;
  onAsk?: () => void;
}) {
  const { isDesktop } = useResponsive();
  const [openMenuState, setOpenMenuState] = useState<MenuKey | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openMenu = openMenuProp !== undefined ? openMenuProp : openMenuState;
  const setOpenMenu = (menu: MenuKey | null) => {
    setOpenMenuState(menu);
    onOpenMenuChange?.(menu);
  };
  // Close an open dropdown on any click outside the trigger+panel cluster (web).
  // Replaces a full-screen click-away overlay that stacked above the panel and
  // blocked its row hover/clicks. No-op on native (dropdowns are web/desktop only).
  const navTriggerGroupRef = useRef<unknown>(null);
  useEffect(() => {
    if (!isWeb || openMenu === null) return;
    const handlePointerDown = (event: Event) => {
      const node = navTriggerGroupRef.current as HTMLElement | null;
      const target = event.target as Node | null;
      if (node && target && node.contains(target)) return;
      setOpenMenu(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu]);
  const dropdownMenus = MENUS.filter((menu) => menu.key !== 'ask');
  // Mobile flattens every menu's roadmap items into one pill row. Search items keep
  // their bare label; Track-only items collapse into a single "Tracking Features"
  // pill rather than listing each one. → Find My Legislator · Candidates · Tracking Features.
  const searchRoadmap = navDropdownItems('search').roadmap;
  const searchRoadmapLabels = new Set(searchRoadmap.map((item) => item.label));
  const trackOnlyRoadmap = navDropdownItems('track').roadmap.filter(
    (item) => !searchRoadmapLabels.has(item.label),
  );
  const mobileRoadmapPills = [
    ...searchRoadmap.map((item) => item.label),
    ...(trackOnlyRoadmap.length > 0 ? ['Tracking Features'] : []),
  ];
  const navigate = (item: IaItem) => {
    setOpenMenu(null);
    setDrawerOpen(false);
    // Contact Us opens mail composition directly rather than routing anywhere
    // in-app — handled once here so every screen's nav gets it for free.
    if (item.id === 'about-contact') {
      const mailto = 'mailto:ask@alethical.com';
      if (isWeb && typeof window !== 'undefined') {
        window.location.href = mailto;
      } else {
        void Linking.openURL(mailto);
      }
      return;
    }
    onNavigate?.(item);
  };

  return (
    <Container style={styles.navRow}>
      <View style={styles.navBar}>
        {onHome ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Alethical home"
            onPress={onHome}
            style={({ pressed }) => [styles.logoLink, pressed && styles.logoLinkPressed]}
          >
            <Logo />
          </Pressable>
        ) : (
          <Logo />
        )}
        {isDesktop ? (
          <View style={styles.navLinks}>
            <View ref={navTriggerGroupRef as never} style={styles.navTriggerGroup}>
              {variant === 'page' ? <AskNavEntry onPress={onAsk} /> : null}
              {dropdownMenus.map((menu) => (
                <NavDropdownTrigger
                  key={menu.key}
                  menu={menu.key}
                  label={menu.label}
                  open={openMenu === menu.key}
                  onToggle={() => setOpenMenu(openMenu === menu.key ? null : menu.key)}
                  onNavigate={navigate}
                />
              ))}
            </View>
            {/* Visible but inert: sign-in isn't available yet (no post-login
                experience shipped), so the button shows without routing anywhere. */}
            <PrimaryButton label="Sign in" onPress={undefined} />
          </View>
        ) : (
          <View style={styles.navMobileRight}>
            {/* Visible but inert: sign-in isn't available yet (no post-login
                experience shipped), so the button shows without routing anywhere. */}
            <PrimaryButton label="Sign in" onPress={undefined} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={drawerOpen ? 'Close menu' : 'Open menu'}
              onPress={() => setDrawerOpen((v) => !v)}
              style={styles.hamburger}
            >
              {drawerOpen ? (
                <X size={22} color={t.colors.ink} />
              ) : (
                <Menu size={22} color={t.colors.ink} />
              )}
            </Pressable>
          </View>
        )}
      </View>
      <Modal
        visible={!isDesktop && drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.menuScrim}>
          {/* Tapping the dimmed area beside the sheet closes the drawer, matching
              the X in the sheet header. Sits behind the sheet (earlier sibling), so
              the sheet's own rows still receive their taps. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={() => setDrawerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.menuSheet}>
            <View style={styles.menuSheetHeader}>
              <Logo variant="menu" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={() => setDrawerOpen(false)}
                style={styles.hamburger}
              >
                <X size={22} color={t.colors.ink} />
              </Pressable>
            </View>
            <ScrollView style={styles.menuList}>
              {variant === 'page' ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    setDrawerOpen(false);
                    onAsk?.();
                  }}
                  style={styles.menuRow}
                >
                  <View style={styles.menuRowInline}>
                    <Sparkle size={18} />
                    <Text style={[styles.menuRowText, { color: t.colors.purple.base }]}>Ask</Text>
                  </View>
                </Pressable>
              ) : null}
              {dropdownMenus.map((menu) => {
                const { live } = navDropdownItems(menu.key);
                if (live.length === 0) return null;
                return (
                  <View key={menu.key} style={styles.menuGroup}>
                    <Text style={styles.menuGroupLabel}>{menu.label.toUpperCase()}</Text>
                    {live.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="link"
                        onPress={() => navigate(item)}
                        style={styles.menuSubRow}
                      >
                        <Text style={styles.menuSubRowText}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
              <View style={styles.mobileRoadmapBlock}>
                <View style={styles.mobileRoadmapLabelRow}>
                  <Text style={styles.roadmapLabel}>ON THE ROADMAP</Text>
                  <View style={styles.roadmapRule} />
                </View>
                <View style={styles.mobileRoadmapPillRow}>
                  {mobileRoadmapPills.map((label) => (
                    <RoadmapPill key={label} label={label} large />
                  ))}
                </View>
              </View>
            </ScrollView>
            <View style={styles.menuFooter}>
              <PrimaryButton label="Sign in" size="lg" onPress={() => setDrawerOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </Container>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, t.shadows.lg as ViewStyle, style]}>{children}</View>;
}

export function Eyebrow({ children }: { children: string }) {
  return (
    <View style={styles.eyebrow}>
      <View style={styles.eyebrowSquare} />
      <Text style={styles.eyebrowText}>{children}</Text>
    </View>
  );
}

// Green mono section label (no square), e.g. "WHAT YOU CAN DO"
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function LabelMono({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.labelMono, style]}>{children}</Text>;
}

// --- Section heading (big display h2 + optional action button) ---
export function SectionHeading({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const [hovered, hoverProps] = useHover();
  return (
    <View style={styles.sectionHeadingRow}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          {...hoverProps}
          style={[styles.viewAll, hovered && { borderColor: t.colors.brand.base }]}
        >
          <Text style={[styles.viewAllText, hovered && { color: t.colors.brand.deep }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// --- Info card ("What you can do") — icon SVGs lifted from the mockup ---
type IconName = 'search' | 'map' | 'bookmark' | 'chat';
function CardIcon({ name }: { name: IconName }) {
  const c = t.colors.brand.deep;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={7} stroke={c} strokeWidth={2} />
          <Path d="M16.5 16.5 L21 21" stroke={c} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'map' ? (
        <>
          <Path
            d="M12 21 C 12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C 19 14.5 12 21 12 21 Z"
            stroke={c}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={9.5} r={2.6} stroke={c} strokeWidth={2} />
        </>
      ) : null}
      {name === 'bookmark' ? (
        <Path d="M7 4 h10 v16 l-5 -4 l-5 4 Z" stroke={c} strokeWidth={2} strokeLinejoin="round" />
      ) : null}
      {name === 'chat' ? (
        <Path
          d="M4 5 h16 v11 h-9 l-5 4 v-4 h-2 Z"
          stroke={c}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  );
}

export function InfoCard({
  icon,
  title,
  subtitle,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.infoCard, isMobile && styles.infoCardMobile]}>
      <View style={styles.infoIcon}>
        <CardIcon name={icon} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

// --- Tag (bill category chip) ---
export function Tag({ children }: { children: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{children}</Text>
    </View>
  );
}

// --- Dark "+ Track" button ---
export function TrackButton({ onPress }: { onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Track bill"
      onPress={onPress}
      {...hoverProps}
      style={[styles.trackBtn, hovered && { opacity: 0.9 }]}
    >
      <Plus size={15} color={t.colors.white} strokeWidth={2.6} />
      <Text style={styles.trackBtnText}>Track</Text>
    </Pressable>
  );
}

// --- Bill card ---
export interface Bill {
  billId: string;
  description: string;
  chamber: string;
  status: string;
  author: string;
  tags: string[];
}

export function BillCard({ bill }: { bill: Bill }) {
  return (
    <View style={styles.billCard}>
      <View style={styles.billTop}>
        <Badge>{bill.billId}</Badge>
        <TrackButton />
      </View>
      <Text style={styles.billDesc}>{bill.description}</Text>
      <LabelMono style={styles.billMeta}>{`${bill.chamber} · ${bill.status}`}</LabelMono>
      <Text style={styles.billAuthor}>
        Author: <Text style={styles.billAuthorName}>{bill.author}</Text>
      </Text>
      <View style={styles.billTags}>
        {bill.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </View>
    </View>
  );
}

// --- Google "G" mark + button ---
function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.909c1.702-1.567 2.682-3.874 2.682-6.615z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.348 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </Svg>
  );
}

export function GoogleButton({ onPress }: { onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[styles.googleBtn, hovered && { borderColor: t.colors.borders.strong }]}
    >
      <GoogleG size={22} />
      <Text style={styles.googleBtnText}>Continue with Google</Text>
    </Pressable>
  );
}

// --- City chip ---
export function CityChip({ label, onPress }: { label: string; onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[styles.cityChip, hovered && { borderColor: t.colors.brand.base }]}
    >
      <Text style={[styles.cityChipText, hovered && { color: t.colors.brand.deep }]}>{label}</Text>
    </Pressable>
  );
}

// --- Address lookup field + Find button ---
export function AddressField() {
  return (
    <View style={styles.addressBar}>
      <View style={styles.addressField}>
        <MapPin size={18} color={t.colors.text.muted} strokeWidth={2.2} />
        <TextInput
          style={styles.addressInput}
          placeholder="Enter an address, city, or area"
          placeholderTextColor={t.colors.text.muted}
        />
      </View>
      <PrimaryButton label="Find" />
    </View>
  );
}

// --- Minnesota map graphic (accurate outline; interior white, brand-green stroke) ---
// The interior is filled from the outer-boundary subpath only; the full two-subpath
// outline is stroked on top. Coordinates live in the flipped source space, so the
// group transform maps them into the 599x658 viewBox.
const MN_INTERIOR_PATH =
  'M1930 5699 l0 -179 -598 0 c-692 0 -639 8 -622 -94 5 -33 23 -88 40 -123 33 -71 36 -93 18 -126 -18 -34 -20 -455 -1 -484 7 -13 22 -62 34 -110 11 -49 41 -140 66 -203 46 -115 46 -115 48 -260 1 -144 26 -376 49 -454 6 -23 9 -54 5 -71 -25 -111 -2 -263 58 -380 40 -80 72 -274 73 -441 0 -91 0 -91 -80 -177 -44 -47 -80 -92 -80 -101 0 -9 19 -52 42 -96 35 -67 46 -80 72 -86 17 -3 48 -13 69 -21 37 -15 37 -15 37 -788 0 -606 3 -775 13 -782 17 -13 3082 -8 3127 5 19 5 30 10 23 11 -18 2 -24 69 -14 151 10 75 10 75 -26 128 -51 75 -138 152 -171 152 -19 0 -36 11 -55 35 -16 20 -46 47 -68 62 -28 19 -47 44 -70 92 -44 95 -44 94 -60 102 -8 4 -40 14 -71 23 -55 16 -78 35 -128 106 -11 15 -30 23 -75 28 -59 7 -62 9 -133 83 -73 77 -73 77 -63 149 6 49 6 91 0 128 -7 37 -7 63 0 81 15 39 71 279 71 307 0 29 -68 101 -105 110 -22 5 -25 11 -25 53 0 36 5 49 21 59 19 12 79 124 79 148 0 12 72 54 177 104 60 28 62 30 70 77 4 26 7 146 5 265 -3 217 -3 217 20 220 17 2 24 11 26 33 2 22 11 34 35 45 18 8 33 24 35 35 2 12 37 45 84 80 257 188 453 367 497 453 32 62 68 99 134 138 34 20 87 55 117 78 78 61 118 79 291 132 167 50 246 85 309 135 80 64 34 125 -63 84 -63 -26 -85 -20 -103 25 -9 22 -25 45 -35 50 -10 6 -111 10 -226 10 -209 0 -209 0 -234 52 -38 81 -43 81 -151 10 -149 -98 -287 -133 -308 -77 -7 18 -17 25 -35 25 -18 0 -31 11 -50 40 -28 44 -45 54 -116 64 -44 6 -48 10 -63 50 -28 73 -52 89 -117 74 -81 -17 -88 -27 -63 -92 9 -23 -38 -21 -60 3 -9 10 -22 49 -29 87 -13 69 -13 69 -80 72 -71 3 -81 12 -45 41 33 28 17 47 -51 60 -42 8 -72 21 -95 42 -28 24 -42 29 -84 29 -28 0 -63 5 -78 10 -33 13 -130 -25 -175 -67 -22 -20 -40 -25 -112 -30 -87 -6 -87 -6 -87 19 0 59 -67 87 -209 88 -31 0 -51 7 -73 25 -20 17 -42 25 -67 25 -60 0 -143 19 -163 37 -13 12 -18 31 -18 74 0 40 -12 97 -40 184 -29 93 -40 143 -40 190 0 79 -9 87 -140 120 l-90 23 0 -179z';
const MN_OUTLINE_PATH =
  'M1930 5699 l0 -179 -598 0 c-692 0 -639 8 -622 -94 5 -33 23 -88 40 -123 33 -71 36 -93 18 -126 -18 -34 -20 -455 -1 -484 7 -13 22 -62 34 -110 11 -49 41 -140 66 -203 46 -115 46 -115 48 -260 1 -144 26 -376 49 -454 6 -23 9 -54 5 -71 -25 -111 -2 -263 58 -380 40 -80 72 -274 73 -441 0 -91 0 -91 -80 -177 -44 -47 -80 -92 -80 -101 0 -9 19 -52 42 -96 35 -67 46 -80 72 -86 17 -3 48 -13 69 -21 37 -15 37 -15 37 -788 0 -606 3 -775 13 -782 17 -13 3082 -8 3127 5 19 5 30 10 23 11 -18 2 -24 69 -14 151 10 75 10 75 -26 128 -51 75 -138 152 -171 152 -19 0 -36 11 -55 35 -16 20 -46 47 -68 62 -28 19 -47 44 -70 92 -44 95 -44 94 -60 102 -8 4 -40 14 -71 23 -55 16 -78 35 -128 106 -11 15 -30 23 -75 28 -59 7 -62 9 -133 83 -73 77 -73 77 -63 149 6 49 6 91 0 128 -7 37 -7 63 0 81 15 39 71 279 71 307 0 29 -68 101 -105 110 -22 5 -25 11 -25 53 0 36 5 49 21 59 19 12 79 124 79 148 0 12 72 54 177 104 60 28 62 30 70 77 4 26 7 146 5 265 -3 217 -3 217 20 220 17 2 24 11 26 33 2 22 11 34 35 45 18 8 33 24 35 35 2 12 37 45 84 80 257 188 453 367 497 453 32 62 68 99 134 138 34 20 87 55 117 78 78 61 118 79 291 132 167 50 246 85 309 135 80 64 34 125 -63 84 -63 -26 -85 -20 -103 25 -9 22 -25 45 -35 50 -10 6 -111 10 -226 10 -209 0 -209 0 -234 52 -38 81 -43 81 -151 10 -149 -98 -287 -133 -308 -77 -7 18 -17 25 -35 25 -18 0 -31 11 -50 40 -28 44 -45 54 -116 64 -44 6 -48 10 -63 50 -28 73 -52 89 -117 74 -81 -17 -88 -27 -63 -92 9 -23 -38 -21 -60 3 -9 10 -22 49 -29 87 -13 69 -13 69 -80 72 -71 3 -81 12 -45 41 33 28 17 47 -51 60 -42 8 -72 21 -95 42 -28 24 -42 29 -84 29 -28 0 -63 5 -78 10 -33 13 -130 -25 -175 -67 -22 -20 -40 -25 -112 -30 -87 -6 -87 -6 -87 19 0 59 -67 87 -209 88 -31 0 -51 7 -73 25 -20 17 -42 25 -67 25 -60 0 -143 19 -163 37 -13 12 -18 31 -18 74 0 40 -12 97 -40 184 -29 93 -40 143 -40 190 0 79 -9 87 -140 120 l-90 23 0 -179z m105 142 c113 -29 115 -31 115 -106 0 -47 11 -97 40 -190 28 -87 40 -144 40 -184 0 -47 4 -61 23 -79 24 -23 102 -42 168 -42 25 0 47 -8 66 -24 23 -19 44 -24 121 -30 115 -8 140 -17 148 -53 12 -59 8 -56 101 -50 72 5 90 10 112 30 45 42 142 80 175 67 15 -5 50 -10 78 -10 42 0 56 -5 84 -29 23 -20 53 -34 94 -42 64 -12 75 -27 38 -51 -41 -27 -17 -48 55 -48 63 0 63 0 74 -66 13 -77 43 -117 83 -112 20 2 24 8 21 28 -9 63 -9 62 53 77 71 16 79 11 112 -63 23 -52 23 -52 86 -63 63 -11 67 -14 111 -76 10 -14 28 -25 40 -25 13 0 26 -9 32 -22 25 -57 164 -24 312 73 55 37 99 59 108 55 8 -3 26 -30 39 -61 25 -55 25 -55 238 -55 117 0 218 -4 224 -8 7 -4 20 -25 30 -47 23 -48 47 -54 110 -30 58 22 88 17 92 -15 6 -53 -110 -116 -337 -184 -173 -53 -213 -71 -291 -132 -30 -23 -83 -58 -116 -78 -68 -39 -113 -85 -144 -147 -45 -87 -217 -244 -487 -444 -60 -44 -93 -75 -93 -87 0 -12 -13 -24 -35 -34 -29 -12 -35 -20 -35 -43 0 -23 -5 -30 -22 -33 -23 -3 -23 -3 -23 -233 -1 -294 -1 -295 -73 -328 -99 -45 -174 -89 -179 -106 -19 -58 -64 -141 -82 -151 -17 -9 -21 -20 -21 -59 0 -48 1 -50 45 -71 48 -23 85 -66 85 -98 0 -25 -57 -268 -71 -303 -7 -18 -7 -44 0 -81 6 -37 6 -79 0 -127 -10 -72 -10 -72 68 -154 77 -81 79 -82 138 -89 41 -5 63 -13 70 -24 42 -73 78 -96 203 -130 7 -2 15 -12 18 -21 25 -75 69 -145 109 -173 25 -17 56 -46 71 -65 19 -25 34 -35 54 -35 35 0 112 -68 163 -142 36 -53 36 -53 26 -128 -5 -41 -7 -92 -3 -112 5 -34 4 -38 -23 -45 -15 -4 -719 -8 -1563 -8 l-1535 1 -3 777 c-2 777 -2 777 -31 791 -15 8 -48 20 -72 27 -42 11 -46 15 -82 88 -21 42 -38 82 -37 89 0 8 36 52 80 99 80 86 80 86 80 177 -1 167 -33 361 -73 441 -60 117 -83 269 -58 380 4 17 1 48 -5 71 -23 78 -48 310 -49 454 -2 145 -2 145 -48 260 -25 63 -55 154 -66 203 -12 48 -27 97 -34 110 -19 29 -17 450 1 484 18 33 15 55 -18 126 -36 75 -55 174 -39 194 9 10 130 13 613 15 l601 3 3 173 c2 128 6 172 15 172 6 0 44 -9 82 -19z';
export function MNMap({ size = 330 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={(size * 658) / 599}
      viewBox="0 0 599 658"
      accessibilityRole="image"
      aria-label="Map of Minnesota"
    >
      <G transform="translate(0,658) scale(0.1,-0.1)">
        <Path d={MN_INTERIOR_PATH} fill={t.colors.white} stroke="none" />
        <Path
          d={MN_OUTLINE_PATH}
          fill="none"
          stroke={t.colors.brand.deep}
          strokeWidth={40}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}

// --- Footer (dark, v2): sovereignty tagline left, legal links right ---
function FooterLink({ label, onPress }: { label: string; onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hoverProps}>
      <Text style={[styles.footerLink, hovered && { color: t.colors.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Footer({ onPrivacy, onTerms }: { onPrivacy?: () => void; onTerms?: () => void }) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.footer}>
      <Container>
        <View style={styles.footerTop}>
          <View style={styles.footerBrand}>
            <Text style={[styles.footerTagline, isMobile && styles.footerTaglineMobile]}>
              We hold these truths to be self-evident.{'\n'}
              <Text style={styles.footerTaglineAccent}>Alethical makes them accessible.</Text>
            </Text>
          </View>
          <View style={styles.footerLinks}>
            <FooterLink label="Privacy Policy" onPress={onPrivacy} />
            <FooterLink label="Terms of Use" onPress={onTerms} />
          </View>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerBottom}>
          <Text style={[styles.footerMeta, isMobile && styles.footerMetaMobile]}>
            {isMobile ? '© 2026 ALETHICAL' : '© 2026 ALETHICAL · BUILT IN MINNESOTA'}
          </Text>
          <Text style={[styles.footerMetaGreen, isMobile && styles.footerMetaMobile]}>
            TRUTH, UNCONCEALED
          </Text>
        </View>
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  pageBg: { flex: 1 },
  container: { width: '100%', paddingHorizontal: 56 },
  containerMobile: { paddingHorizontal: 24 },
  metaStripe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 56,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.borders.base,
  },
  metaStripeMobile: { paddingHorizontal: 24 },
  metaText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 1.9,
    color: t.colors.text.faint,
  },
  logoLink: { alignSelf: 'center' },
  logoLinkPressed: { opacity: 0.72 },
  navRow: { paddingTop: 26, paddingBottom: 8, zIndex: 60 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: 30 },
  navTriggerGroup: { flexDirection: 'row', alignItems: 'center', gap: 34 },
  navMobileRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // v2 dropdown triggers + panels
  navTriggerWrap: { position: 'relative', zIndex: 60 },
  navTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  navTriggerText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.medium,
  },
  menuPanelAnchor: { position: 'absolute', zIndex: 60 },
  menuPanel: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 16,
    padding: 10,
  },
  menuPanelNotch: {
    position: 'absolute',
    top: -8,
    width: 15,
    height: 15,
    backgroundColor: t.colors.surfaces.base,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: t.colors.alpha.ink14,
    transform: [{ rotate: '45deg' }],
  },
  menuPanelList: { gap: 6 },
  menuPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  menuPanelRowHover: { backgroundColor: t.colors.alpha.ink06 },
  menuRowIconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRowIconTileDisabled: { backgroundColor: t.colors.surfaces.s300 },
  menuRowBody: { flex: 1, minWidth: 0 },
  menuRowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuRowTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  menuRowTitleDisabled: { fontWeight: t.fontWeights.semibold, color: t.colors.text.faint },
  menuRowDesc: {
    marginTop: 3,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 19,
    color: t.colors.text.muted,
  },
  menuRowDescDisabled: { color: '#b3b9b4' },
  roadmapLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  roadmapLabel: {
    fontFamily: t.typography.mono,
    // 12 (label), matching the SEARCH/ABOUT group eyebrows — 11 (caption) left
    // it the smallest text in the drawer for no reason.
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.2,
    color: t.colors.text.faint,
  },
  roadmapRule: { flex: 1, height: 1, backgroundColor: t.colors.alpha.ink07 },
  roadmapPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  roadmapPill: {
    backgroundColor: t.colors.surfaces.s300,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  roadmapPillLarge: { paddingVertical: 8, paddingHorizontal: 15 },
  roadmapPillText: {
    fontFamily: t.typography.title,
    fontSize: 13,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.faint,
  },
  roadmapPillTextLarge: { fontSize: 14 },
  mobileRoadmapBlock: { paddingTop: 16, gap: 12 },
  mobileRoadmapLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mobileRoadmapPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // mobile drawer groups
  menuGroup: { paddingVertical: 14, gap: 2 },
  menuGroupLabel: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.68,
    // forest (green700), not deep (green600): at 12px this label needs ≥4.5:1 on
    // white; deep is only ~3.5:1, forest is ~5.4:1 (WCAG AA). Scoped to this small
    // label so the brand green elsewhere (larger, passes at 3:1) is unaffected.
    color: t.colors.brand.forest,
    marginBottom: 6,
  },
  // paddingVertical 12 (not 9) gives the 21px rows more breathing room within a
  // group and lifts each row's tap target to ~49px (clears the 44px minimum).
  menuSubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  menuSubRowText: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  menuRowInline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hamburger: {
    padding: 9,
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
  },
  // Right-side drawer: page stays dimmed on the left, sheet covers ~84% of the width.
  menuScrim: {
    flex: 1,
    backgroundColor: 'rgba(6,35,26,0.45)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    width: '84%',
    maxWidth: 420,
    height: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    paddingHorizontal: 24,
    // Match the nav row's top offset (navRow paddingTop 26) so the drawer's
    // mark + close button open at the same center line as the nav's logo +
    // hamburger — no vertical hop when the menu opens.
    paddingTop: 28,
    paddingBottom: 28,
  },
  menuSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuList: { flex: 1, marginTop: 40 },
  menuRow: { paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: t.colors.borders.base },
  menuRowText: {
    fontFamily: t.typography.title,
    fontSize: 27,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  menuFooter: {},
  primaryBtn: {
    borderRadius: t.radii.md,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLg: { paddingVertical: 14, paddingHorizontal: 30 },
  primaryBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.onGreen,
  },
  primaryBtnTextLg: { fontSize: t.fontSizes.h4, fontWeight: t.fontWeights.bold },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.badge,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.brand.deep,
  },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 34,
  },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowSquare: { width: 13, height: 13, borderRadius: 0, backgroundColor: t.colors.brand.base },
  eyebrowText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  sectionLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2,
    color: t.colors.brand.deep,
  },
  labelMono: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 1.2,
    color: t.colors.text.muted,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  sectionHeading: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.displayLg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.2,
    color: t.colors.text.primary,
  },
  viewAll: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 18,
  },
  viewAllText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
    color: t.colors.text.primary,
  },
  infoCard: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.lg,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  infoCardMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 18,
    paddingVertical: 20,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: t.radii.sm,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, minWidth: 0, gap: 3 },
  infoTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  infoSubtitle: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
  },
  tag: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tagText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
  },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.ink,
    borderRadius: t.radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  trackBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  billCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.lg,
    padding: 24,
    gap: 12,
  },
  billTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  billDesc: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 27,
    color: t.colors.text.primary,
  },
  billMeta: { marginTop: 2 },
  billAuthor: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.secondary,
  },
  billAuthorName: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  billTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.md,
    paddingVertical: 16,
    paddingHorizontal: 28,
    ...(t.shadows.sm as object),
  },
  googleBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  cityChip: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  cityChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 0.7,
    color: t.colors.text.primary,
  },
  addressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.md,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    width: '100%',
    maxWidth: 560,
    ...(t.shadows.sm as object),
  },
  addressField: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  addressInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.primary,
    paddingVertical: 12,
    ...(isWeb ? ({ outlineStyle: 'none' } as any) : null),
  },
  footer: { backgroundColor: t.colors.footerBg, paddingTop: 56, paddingBottom: 44 },
  footerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 48,
  },
  footerBrand: { maxWidth: 480 },
  footerTagline: {
    fontFamily: t.typography.body,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '300' as const,
    letterSpacing: -0.2,
    color: '#eef1ef',
  },
  footerTaglineMobile: { fontSize: 19, lineHeight: 28 },
  // Mobile home scales footer meta lines up for legibility (2nd-pass delta #6).
  footerMetaMobile: { fontSize: 15 },
  footerTaglineAccent: { color: t.colors.brand.bright },
  footerLinks: { flexDirection: 'row', alignItems: 'center', gap: 34 },
  footerLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.medium,
    color: '#cfd6d2',
  },
  footerDivider: {
    height: 1,
    backgroundColor: t.colors.alpha.white12,
    marginTop: 40,
    marginBottom: 24,
  },
  footerBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 24,
  },
  footerMeta: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    letterSpacing: 1.3,
    color: t.colors.text.muted,
  },
  footerMetaGreen: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    letterSpacing: 1.8,
    color: t.colors.brand.bright,
  },
});
