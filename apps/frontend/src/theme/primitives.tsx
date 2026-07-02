import { ReactNode, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { theme } from './tokens';

// Reusable primitives for the redesign, built on the green token system
// (see theme/tokens.ts, extracted from docs/mockups/*.html). Web-first;
// gradients use web background styles gated behind Platform.OS === 'web'.

const isWeb = Platform.OS === 'web';
const t = theme;

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

// --- Page background: light vertical gradient + green wash + dot grid ---
export function PageBackground({
  children,
  variant = 'page',
}: {
  children: ReactNode;
  variant?: 'page' | 'pageGreen';
}) {
  const webBg = isWeb
    ? ({
        backgroundColor: t.colors.surfaces.s200,
        backgroundImage: `${t.gradients.dotInk}, ${variant === 'pageGreen' ? t.gradients.pageGreen : t.gradients.page}`,
        backgroundSize: '22px 22px, 100% 100%',
        backgroundRepeat: 'repeat, no-repeat',
      } as unknown as ViewStyle)
    : { backgroundColor: t.colors.surfaces.s200 };
  return <View style={[styles.pageBg, webBg]}>{children}</View>;
}

export function Container({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.container, style]}>{children}</View>;
}

// --- Meta stripe (thin top bar) ---
export function MetaStripe({ left, right }: { left: string; right: string }) {
  return (
    <View style={styles.metaStripe}>
      <Text style={styles.metaText}>{left}</Text>
      <Text style={styles.metaText}>{right}</Text>
    </View>
  );
}

// --- Brand logo (bar mark + wordmark) ---
export function Logo() {
  return (
    <View style={styles.logo}>
      <View style={styles.logoMark}>
        <View style={[styles.logoBar, { height: 10, backgroundColor: t.colors.brand.deep }]} />
        <View style={[styles.logoBar, { height: 16, backgroundColor: t.colors.ink }]} />
        <View style={[styles.logoBar, { height: 22, backgroundColor: t.colors.brand.base }]} />
      </View>
      <Text style={styles.wordmark}>ALETHICAL</Text>
    </View>
  );
}

// --- Nav link (optional dropdown caret) ---
export function NavLink({ label, caret, onPress }: { label: string; caret?: boolean; onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hoverProps} style={styles.navLink}>
      <Text style={[styles.navLinkText, hovered && { color: t.colors.text.primary }]}>{label}</Text>
      {caret ? <ChevronDown size={15} color={hovered ? t.colors.text.primary : t.colors.text.secondary} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

// --- Buttons ---
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

// --- Badge (SF 2310 / HF 1 style) ---
export function Badge({ children }: { children: ReactNode }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

// --- Card ---
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, t.shadows.lg as ViewStyle, style]}>{children}</View>;
}

// --- Typography ---
export function Eyebrow({ children }: { children: string }) {
  return (
    <View style={styles.eyebrow}>
      <View style={styles.eyebrowSquare} />
      <Text style={styles.eyebrowText}>{children}</Text>
    </View>
  );
}

export function LabelMono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.labelMono, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  pageBg: { flex: 1 },
  container: {
    width: '100%',
    maxWidth: t.layout.maxWidth,
    marginHorizontal: 'auto',
    paddingHorizontal: 32,
  },
  metaStripe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.borders.base,
  },
  metaText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 24 },
  logoBar: { width: 6, borderRadius: 2 },
  wordmark: {
    fontFamily: t.typography.title,
    fontSize: 20,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.text.primary,
  },
  navLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 4 },
  navLinkText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
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
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.lg,
    padding: 24,
  },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowSquare: { width: 10, height: 10, borderRadius: 2, backgroundColor: t.colors.brand.base },
  eyebrowText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.2,
    color: t.colors.brand.deep,
  },
  labelMono: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 1.6,
    color: t.colors.text.muted,
  },
});
