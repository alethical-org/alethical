import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';

import { theme } from '../../theme/tokens';
import {
  Badge,
  Card,
  Container,
  Eyebrow,
  LabelMono,
  Logo,
  MetaStripe,
  NavLink,
  PageBackground,
  PrimaryButton,
} from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';

const t = theme;

function CitationRow({ label, page }: { label: string; page: string }) {
  return (
    <View style={styles.citation}>
      <View style={styles.citationDot} />
      <Text style={styles.citationLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.citationPage}>{page}</Text>
    </View>
  );
}

function Stat({ value, valueColor, label }: { value: string; valueColor: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
      <LabelMono style={styles.statLabel}>{label}</LabelMono>
    </View>
  );
}

export function HomeSignedOutScreen() {
  const { isDesktop } = useResponsive();

  return (
    <PageBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <MetaStripe left="ALETHICAL · CIVIC RECORD" right="VOL. 1 · 89TH SESSION · MARCH 21, 2026" />

        {/* Top nav */}
        <Container style={styles.navRow}>
          <Logo />
          {isDesktop ? (
            <View style={styles.navLinks}>
              <NavLink label="Ask AI" />
              <NavLink label="Search" caret />
              <NavLink label="Track" caret />
              <NavLink label="About" caret />
              <PrimaryButton label="Sign in" />
            </View>
          ) : (
            <PrimaryButton label="Sign in" />
          )}
        </Container>

        {/* Hero */}
        <Container style={[styles.hero, isDesktop && styles.heroDesktop]}>
          <View style={[styles.heroLeft, isDesktop && styles.heroLeftDesktop]}>
            <Eyebrow>TRUTH, UNCONCEALED</Eyebrow>
            <Text style={[styles.display, { fontSize: isDesktop ? t.fontSizes.heroXl : 44 }]}>
              Grounded answers{'\n'}
              <Text style={{ color: t.colors.brand.deep }}>on Minnesota law</Text>
            </Text>
            <Text style={styles.subhead}>
              Plain-language legislative intelligence for search, tracking, and grounded bill questions — every
              answer traceable to the bill text it came from.
            </Text>

            {/* Ask bar */}
            <View style={styles.askBar}>
              <Search size={20} color={t.colors.text.muted} strokeWidth={2.2} />
              <TextInput
                style={styles.askInput}
                placeholder="Ask about any bill, statute, or legislator…"
                placeholderTextColor={t.colors.text.muted}
                editable={false}
              />
              <PrimaryButton label="Ask" size="lg" />
            </View>
          </View>

          {/* Answer card */}
          <View style={[styles.heroRight, isDesktop && styles.heroRightDesktop]}>
            <Card>
              <View style={styles.cardHead}>
                <Badge>SF 2310</Badge>
                <Text style={styles.sourcesCited}>3 sources cited</Text>
              </View>
              <Text style={styles.answerBody}>
                Adult-use cannabis sales begin under a state license framework, with a{' '}
                <Text style={styles.answerStrong}>10% gross-receipts tax</Text> and local opt-out provisions for
                municipalities.
              </Text>
              <View style={styles.citationList}>
                <CitationRow label="Sec. 342.10 — License classes" page="p.14" />
                <CitationRow label="Sec. 295.81 — Gross-receipts tax" page="p.31" />
              </View>
            </Card>
          </View>
        </Container>

        {/* Stat band */}
        <Container style={[styles.statBand, isDesktop && styles.statBandDesktop]}>
          <Stat value="201" valueColor={t.colors.text.primary} label="LEGISLATORS TRACKED" />
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <LabelMono style={styles.liveText}>LIVE IN MINNESOTA</LabelMono>
          </View>
          <Stat value="100%" valueColor={t.colors.brand.deep} label="OF ANSWERS CITED TO SOURCE" />
        </Container>
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 64 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 22,
    paddingBottom: 8,
  },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  hero: { paddingTop: 40, gap: 40 },
  heroDesktop: { flexDirection: 'row', alignItems: 'center', gap: 56, paddingTop: 64 },
  heroLeft: { gap: 22 },
  heroLeftDesktop: { flex: 1.05 },
  display: {
    fontFamily: t.typography.title,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.text.primary,
    lineHeight: undefined,
    letterSpacing: -1,
  },
  subhead: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subheadLg,
    lineHeight: 28,
    color: t.colors.text.secondary,
    maxWidth: 520,
  },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.lg,
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 8,
    marginTop: 6,
    maxWidth: 620,
    ...(t.shadows.card as object),
  },
  askInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.primary,
    paddingVertical: 12,
  },
  heroRight: {},
  heroRightDesktop: { width: 440 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  sourcesCited: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
  answerBody: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 25,
    color: t.colors.text.primary,
  },
  answerStrong: { fontWeight: t.fontWeights.bold },
  citationList: { marginTop: 18, gap: 8 },
  citation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  citationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.brand.base },
  citationLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.ink,
  },
  citationPage: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  statBand: {
    marginTop: 72,
    gap: 28,
    alignItems: 'center',
  },
  statBandDesktop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 96,
  },
  stat: { gap: 8, alignItems: 'flex-start' },
  statValue: {
    fontFamily: t.typography.title,
    fontSize: 64,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -2,
    lineHeight: 66,
  },
  statLabel: {},
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    backgroundColor: t.colors.tint.t50,
    borderRadius: t.radii.pill,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.brand.base },
  liveText: { color: t.colors.brand.deep, fontSize: t.fontSizes.meta },
});
