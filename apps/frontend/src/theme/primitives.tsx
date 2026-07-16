import { ReactNode, useEffect, useRef, useState } from 'react';
import {
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
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
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

// --- Brand logo (bar mark + wordmark). tone controls text color for dark
//     surfaces; compact shrinks it for narrow (mobile) nav bars. ---
export function Logo({
  tone = 'dark',
  compact = false,
}: {
  tone?: 'dark' | 'light';
  compact?: boolean;
}) {
  const light = tone === 'light';
  const fill = light ? t.colors.white : t.colors.ink;
  const dim = compact ? 28 : light ? 30 : 40;
  return (
    <View style={[styles.logo, light && styles.logoLight, compact && styles.logoCompact]}>
      <Svg width={dim} height={dim} viewBox="0 0 64 64" fill="none">
        <Rect x={15} y={29} width={7.5} height={21} rx={3.75} fill={fill} />
        <Rect x={28.25} y={15} width={7.5} height={35} rx={3.75} fill={fill} />
        <Rect x={41.5} y={35} width={7.5} height={15} rx={3.75} fill={fill} />
      </Svg>
      <Text
        style={[styles.wordmark, light && styles.wordmarkLight, compact && styles.wordmarkCompact]}
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

/** Purple "Grounded Ask" pill (Search → Bills row). Sora is the pill's typeface. */
function GroundedAskPill() {
  return (
    <View style={styles.gaPill}>
      <Sparkle size={11} />
      <Text style={styles.gaPillText}>Grounded Ask</Text>
    </View>
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
        {itemId === 'about-trust' ? (
          <>
            <Path
              d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3Z"
              stroke={c}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Path
              d="M9 12l2.2 2.2L15.5 10"
              stroke={c}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
          {item.id === 'search-bills' ? <GroundedAskPill /> : null}
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
  // their bare label; Track-only items are prefixed ("Legislators" → "Track Legislators")
  // to disambiguate. → Issues · Candidates · Track Legislators.
  const searchRoadmap = navDropdownItems('search').roadmap;
  const searchRoadmapLabels = new Set(searchRoadmap.map((item) => item.label));
  const mobileRoadmapPills = [
    ...searchRoadmap.map((item) => item.label),
    ...navDropdownItems('track')
      .roadmap.filter((item) => !searchRoadmapLabels.has(item.label))
      .map((item) => `Track ${item.label}`),
  ];
  const navigate = (item: IaItem) => {
    setOpenMenu(null);
    setDrawerOpen(false);
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
            <Logo compact={!isDesktop} />
          </Pressable>
        ) : (
          <Logo compact={!isDesktop} />
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
            <PrimaryButton label="Sign in" onPress={onSignIn} />
          </View>
        ) : (
          <View style={styles.navMobileRight}>
            <PrimaryButton label="Sign in" onPress={onSignIn} />
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
          <View style={styles.menuSheet}>
            <View style={styles.menuSheetHeader}>
              <Logo compact />
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
                        {item.id === 'search-bills' ? <GroundedAskPill /> : null}
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
              <PrimaryButton
                label="Sign in"
                size="lg"
                onPress={() => {
                  setDrawerOpen(false);
                  onSignIn?.();
                }}
              />
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

// --- Minnesota map graphic (paths lifted from the mockup) ---
export function MNMap({ size = 300 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 120 150">
      <Ellipse cx={58} cy={76} rx={54} ry={64} fill={t.colors.alpha.green10} />
      <Path
        d="M31 20 L31 6 L44 6 L44 20 L78 20 L104 9 L74 58 L70 76 L76 94 L70 112 L77 130 L78 134 L12 134 L12 20 Z"
        fill={t.colors.white}
        stroke={t.colors.brand.deep}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Path
        d="M65 84 c-6 0 -11 5 -11 11 c0 8 11 19 11 19 c0 0 11 -11 11 -19 c0 -6 -5 -11 -11 -11 Z"
        fill={t.colors.ink}
      />
      <Circle cx={65} cy={95} r={4} fill={t.colors.white} />
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
  logoLink: { alignSelf: 'flex-start' },
  logoLinkPressed: { opacity: 0.72 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  logoLight: { gap: 12 },
  logoCompact: { gap: 10 },
  wordmark: {
    fontFamily: t.typography.title,
    fontSize: 25,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 4,
    color: t.colors.text.primary,
  },
  wordmarkLight: { fontSize: 20, color: t.colors.white },
  wordmarkCompact: { fontSize: 17, letterSpacing: 2 },
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
  gaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingLeft: 7,
    paddingRight: 8,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
  },
  gaPillText: {
    fontFamily: t.typography.sora,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.2,
    color: t.colors.purple.base,
  },
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
    fontSize: t.fontSizes.caption,
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
    color: t.colors.brand.deep,
    marginBottom: 6,
  },
  menuSubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
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
    paddingTop: 20,
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
