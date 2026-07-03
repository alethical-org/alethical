import { ReactNode, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Bookmark, ChevronDown, MapPin, Menu, MessageSquare, Plus, Search, X } from 'lucide-react-native';

import { theme } from './tokens';
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
export function PageBackground({ children, variant = 'page' }: { children: ReactNode; variant?: 'page' | 'pageGreen' }) {
  const baseWeb = isWeb
    ? ({
        backgroundColor: t.colors.surfaces.s200,
        backgroundImage: variant === 'pageGreen' ? t.gradients.pageGreen : t.gradients.page,
      } as unknown as ViewStyle)
    : { backgroundColor: t.colors.surfaces.s200 };
  const dotsWeb = {
    backgroundImage: 'radial-gradient(rgba(17,21,15,0.05) 1.3px, transparent 1.5px)',
    backgroundSize: '24px 24px',
    maskImage: 'linear-gradient(to bottom, transparent 0, #000 220px, #000 68%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 220px, #000 68%, transparent 100%)',
  } as unknown as ViewStyle;
  return (
    <View style={[styles.pageBg, baseWeb]}>
      {isWeb ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, dotsWeb]} /> : null}
      {children}
    </View>
  );
}

export function Container({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.container, style]}>{children}</View>;
}

export function MetaStripe({ left, right }: { left: string; right: string }) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.metaStripe}>
      <Text style={styles.metaText}>{left}</Text>
      {!isMobile ? <Text style={styles.metaText}>{right}</Text> : null}
    </View>
  );
}

// --- Brand logo (bar mark + wordmark). tone controls text color for dark surfaces. ---
export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <View style={styles.logo}>
      <View style={styles.logoMark}>
        <View style={[styles.logoBar, { height: 10, backgroundColor: t.colors.brand.deep }]} />
        <View style={[styles.logoBar, { height: 16, backgroundColor: tone === 'light' ? t.colors.white : t.colors.ink }]} />
        <View style={[styles.logoBar, { height: 22, backgroundColor: t.colors.brand.base }]} />
      </View>
      <Text style={[styles.wordmark, tone === 'light' && { color: t.colors.white }]}>ALETHICAL</Text>
    </View>
  );
}

export function NavLink({ label, caret, onPress }: { label: string; caret?: boolean; onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hoverProps} style={styles.navLink}>
      <Text style={[styles.navLinkText, hovered && { color: t.colors.text.primary }]}>{label}</Text>
      {caret ? <ChevronDown size={15} color={hovered ? t.colors.text.primary : t.colors.text.secondary} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, size = 'md' }: { label: string; onPress?: () => void; size?: 'md' | 'lg' }) {
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

// --- Top navigation (desktop links / mobile hamburger menu) ---
export function TopNav({ items }: { items: { label: string; caret?: boolean }[] }) {
  const { isDesktop } = useResponsive();
  const [open, setOpen] = useState(false);
  return (
    <Container style={styles.navRow}>
      <View style={styles.navBar}>
        <Logo />
        {isDesktop ? (
          <View style={styles.navLinks}>
            {items.map((item) => (
              <NavLink key={item.label} label={item.label} caret={item.caret} />
            ))}
            <PrimaryButton label="Sign in" />
          </View>
        ) : (
          <View style={styles.navMobileRight}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={open ? 'Close menu' : 'Open menu'}
              onPress={() => setOpen((v) => !v)}
              style={styles.hamburger}
            >
              {open ? <X size={22} color={t.colors.ink} /> : <Menu size={22} color={t.colors.ink} />}
            </Pressable>
            <PrimaryButton label="Sign in" />
          </View>
        )}
      </View>
      {!isDesktop && open ? (
        <View style={styles.menuPanel}>
          {items.map((item) => (
            <View key={item.label} style={styles.menuItem}>
              <NavLink label={item.label} caret={item.caret} />
            </View>
          ))}
        </View>
      ) : null}
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

export function LabelMono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.labelMono, style]}>{children}</Text>;
}

// --- Section heading (big display h2 + optional action button) ---
export function SectionHeading({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
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
          <Text style={[styles.viewAllText, hovered && { color: t.colors.brand.deep }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// --- Info card ("What you can do") ---
type IconName = 'search' | 'map' | 'bookmark' | 'chat';
const iconFor = (name: IconName, color: string) => {
  const p = { size: 20, color, strokeWidth: 2.2 };
  if (name === 'map') return <MapPin {...p} />;
  if (name === 'bookmark') return <Bookmark {...p} />;
  if (name === 'chat') return <MessageSquare {...p} />;
  return <Search {...p} />;
};

export function InfoCard({ icon, title, subtitle }: { icon: IconName; title: string; subtitle: string }) {
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoIcon}>{iconFor(icon, t.colors.brand.deep)}</View>
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
      <Path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.909c1.702-1.567 2.682-3.874 2.682-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.348 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
      <Path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
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
          editable={false}
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
      <Circle cx={74} cy={74} r={52} fill={t.colors.brand.base} fillOpacity={0.12} />
      <Path
        d="M31 20 L31 6 L44 6 L44 20 L78 20 L104 9 L74 58 L70 76 L76 94 L70 112 L77 130 L78 134 L12 134 L12 20 Z"
        fill={t.colors.tint.t50}
        stroke={t.colors.brand.deep}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <Path d="M72 84 c-6 0 -11 5 -11 11 c0 8 11 19 11 19 c0 0 11 -11 11 -19 c0 -6 -5 -11 -11 -11 Z" fill={t.colors.ink} />
      <Circle cx={72} cy={95} r={3.6} fill={t.colors.white} />
    </Svg>
  );
}

// --- Footer (dark) ---
export function Footer() {
  return (
    <View style={styles.footer}>
      <Container>
        <View style={styles.footerTop}>
          <View style={styles.footerBrand}>
            <Logo tone="light" />
            <Text style={styles.footerTagline}>
              Grounded answers on Minnesota law — every answer traceable to the bill text it came from.
            </Text>
          </View>
          <View style={styles.footerLinks}>
            <Text style={styles.footerLink}>Privacy Policy</Text>
            <Text style={styles.footerLink}>Terms of Use</Text>
          </View>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerBottom}>
          <LabelMono style={styles.footerMeta}>© 2026 ALETHICAL · BUILT IN MINNESOTA</LabelMono>
          <LabelMono style={styles.footerMeta}>100% OF ANSWERS CITED TO SOURCE</LabelMono>
          <LabelMono style={styles.footerMetaGreen}>TRUTH, UNCONCEALED</LabelMono>
        </View>
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  pageBg: { flex: 1 },
  container: { width: '100%', maxWidth: t.layout.maxWidth, marginHorizontal: 'auto', paddingHorizontal: 32 },
  metaStripe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.borders.base,
  },
  metaText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.label, fontWeight: t.fontWeights.medium, letterSpacing: 1.9, color: t.colors.text.faint },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 24 },
  logoBar: { width: 6, borderRadius: 2 },
  wordmark: { fontFamily: t.typography.title, fontSize: 20, fontWeight: t.fontWeights.bold, letterSpacing: 2.4, color: t.colors.text.primary },
  navRow: { paddingTop: 22, paddingBottom: 8 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  navMobileRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hamburger: { padding: 8, borderRadius: t.radii.sm },
  menuPanel: {
    marginTop: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.md,
    paddingHorizontal: 14,
    ...(t.shadows.card as object),
  },
  menuItem: { borderBottomWidth: 1, borderBottomColor: t.colors.borders.base, paddingVertical: 4 },
  navLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 4 },
  navLinkText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.subhead, fontWeight: t.fontWeights.medium, color: t.colors.text.secondary },
  primaryBtn: { borderRadius: t.radii.md, paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  primaryBtnLg: { paddingVertical: 14, paddingHorizontal: 30 },
  primaryBtnText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.subhead, fontWeight: t.fontWeights.semibold, color: t.colors.text.onGreen },
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
  badgeText: { fontFamily: t.typography.mono, fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.bold, letterSpacing: 0.4, color: t.colors.brand.deep },
  card: { backgroundColor: t.colors.surfaces.base, borderWidth: 1, borderColor: t.colors.borders.base, borderRadius: t.radii.lg, padding: 24 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowSquare: { width: 13, height: 13, borderRadius: 0, backgroundColor: t.colors.brand.base },
  eyebrowText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.small, fontWeight: t.fontWeights.semibold, letterSpacing: 2.4, color: t.colors.brand.deep },
  sectionLabel: { fontFamily: t.typography.ui, fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.bold, letterSpacing: 2, color: t.colors.brand.deep },
  labelMono: { fontFamily: t.typography.ui, fontSize: t.fontSizes.label, fontWeight: t.fontWeights.medium, letterSpacing: 1.2, color: t.colors.text.muted },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  sectionHeading: { fontFamily: t.typography.title, fontSize: t.fontSizes.hero, fontWeight: t.fontWeights.heavy, letterSpacing: -1.4, color: t.colors.text.primary },
  viewAll: { borderWidth: 1, borderColor: t.colors.borders.base, borderRadius: t.radii.sm, paddingVertical: 10, paddingHorizontal: 16 },
  viewAllText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.label, fontWeight: t.fontWeights.bold, letterSpacing: 1.6, color: t.colors.text.primary },
  infoCard: {
    flex: 1,
    minWidth: 200,
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
  infoIcon: { width: 40, height: 40, borderRadius: t.radii.sm, backgroundColor: t.colors.tint.t150, alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, minWidth: 0, gap: 3 },
  infoTitle: { fontFamily: t.typography.title, fontSize: t.fontSizes.subhead, fontWeight: t.fontWeights.bold, color: t.colors.text.primary },
  infoSubtitle: { fontFamily: t.typography.body, fontSize: t.fontSizes.body, color: t.colors.text.secondary },
  tag: { backgroundColor: t.colors.surfaces.s400, borderRadius: t.radii.sm, paddingVertical: 6, paddingHorizontal: 12 },
  tagText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.label, fontWeight: t.fontWeights.bold, letterSpacing: 0.7, color: t.colors.text.secondary },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.ink,
    borderRadius: t.radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  trackBtnText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.small, fontWeight: t.fontWeights.bold, color: t.colors.white },
  billCard: { backgroundColor: t.colors.surfaces.base, borderWidth: 1, borderColor: t.colors.borders.base, borderRadius: t.radii.lg, padding: 24, gap: 12 },
  billTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  billDesc: { fontFamily: t.typography.body, fontSize: t.fontSizes.subhead, lineHeight: 27, color: t.colors.text.primary },
  billMeta: { marginTop: 2 },
  billAuthor: { fontFamily: t.typography.body, fontSize: t.fontSizes.bodyLg, color: t.colors.text.secondary },
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
  googleBtnText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.bodyLg, fontWeight: t.fontWeights.semibold, color: t.colors.text.primary },
  cityChip: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  cityChipText: { fontFamily: t.typography.ui, fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.semibold, letterSpacing: 0.7, color: t.colors.text.primary },
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
    maxWidth: 560,
    ...(t.shadows.sm as object),
  },
  addressField: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  addressInput: { flex: 1, minWidth: 0, fontFamily: t.typography.body, fontSize: t.fontSizes.bodyLg, color: t.colors.text.primary, paddingVertical: 12 },
  footer: { backgroundColor: t.colors.ink, paddingVertical: 44, marginTop: 8 },
  footerTop: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 },
  footerBrand: { gap: 14, maxWidth: 420 },
  footerTagline: { fontFamily: t.typography.body, fontSize: t.fontSizes.body, lineHeight: 23, color: t.colors.text.faint },
  footerLinks: { flexDirection: 'row', gap: 28 },
  footerLink: { fontFamily: t.typography.ui, fontSize: t.fontSizes.body, fontWeight: t.fontWeights.medium, color: t.colors.surfaces.s400 },
  footerDivider: { height: 1, backgroundColor: t.colors.alpha.white14, marginVertical: 28 },
  footerBottom: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  footerMeta: { color: t.colors.text.muted, letterSpacing: 1.4 },
  footerMetaGreen: { color: t.colors.brand.base, letterSpacing: 1.4 },
});
