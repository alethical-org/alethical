import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';

import { theme } from '../../theme/tokens';
import {
  AddressField,
  Badge,
  Bill,
  BillCard,
  Card,
  CityChip,
  Container,
  Eyebrow,
  Footer,
  GoogleButton,
  InfoCard,
  MetaStripe,
  MNMap,
  PageBackground,
  PageDots,
  PrimaryButton,
  SectionHeading,
  SectionLabel,
  TopNav,
} from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';

const t = theme;
const isWeb = Platform.OS === 'web';

// Web-only section backgrounds (green→white gradients)
const protoBgWeb: any = isWeb ? { backgroundImage: 'linear-gradient(180deg,#f2f9f5 0%,#ffffff 100%)' } : {};
// Find band: plain green gradient base; the dot grid is a separate masked overlay so it
// fades IN from plain green at the top into dots lower down (per the mockup).
const findBgWeb: any = isWeb ? { backgroundImage: 'linear-gradient(180deg,#eaf6ef 0%,#f2f9f5 45%,#ffffff 100%)' } : {};
const findDotsWeb: any = isWeb
  ? {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundImage: 'radial-gradient(rgba(20,157,91,0.09) 1.3px, transparent 1.4px)',
      backgroundSize: '30px 30px',
      maskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 88%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 88%)',
      pointerEvents: 'none',
    }
  : {};
// Kill the hero ask-bar's card shadow on mobile (the card treatment is dropped there).
const askBarMobileWeb: any = isWeb ? { boxShadow: 'none' } : {};
// Green radial glow behind the hero (lower-left), per the mockup
const heroGlowWeb: any = isWeb
  ? {
      position: 'absolute',
      left: -120,
      top: 130,
      width: 560,
      height: 420,
      backgroundImage: 'radial-gradient(50% 50% at 50% 50%, rgba(45,212,126,0.12) 0%, rgba(45,212,126,0) 70%)',
      pointerEvents: 'none',
    }
  : {};

const RECENT_BILLS: Bill[] = [
  {
    billId: 'HF 1',
    description:
      'The bill establishes an Office of Inspector General to enhance oversight of state-funded services, prevent fraud, and protect whistleblowers.',
    chamber: 'HOUSE',
    status: 'PROPOSED',
    author: 'Patti Anderson',
    tags: ['FRAUD PREVENTION', 'GOVERNMENT ACCOUNTABILITY', 'GRANT OVERSIGHT'],
  },
  {
    billId: 'SF 1',
    description:
      'The bill appropriates $2,500,000 from the bond proceeds fund for the development of a campground and recreational area in Brookston. It authorizes the sale and issuance of state bonds to fund this project and outlines the uses of the appropriated funds.',
    chamber: 'SENATE',
    status: 'IN COMMITTEE',
    author: 'Senator Jason Rarick',
    tags: ['CAPITAL INVESTMENT', 'RECREATION', 'LOCAL DEVELOPMENT'],
  },
  {
    billId: 'HF 2',
    description:
      'The bill mandates that state employees report suspected fraud immediately to their supervisors or relevant authorities and strengthens the requirements for grants management. It amends several sections of Minnesota Statutes to enhance accountability, transparency, and oversight in grant processes.',
    chamber: 'HOUSE',
    status: 'PROPOSED',
    author: 'Ben Davis',
    tags: ['STATE GOVERNMENT', 'GRANTS MANAGEMENT', 'FRAUD PREVENTION'],
  },
  {
    billId: 'SF 2',
    description:
      'The bill appropriates $7,000,000 from the bond proceeds fund to support the renovation of the wastewater treatment pond system in Pine City. It also authorizes the state to sell and issue bonds to fund this appropriation, following relevant Minnesota statutory and constitutional provisions.',
    chamber: 'SENATE',
    status: 'IN COMMITTEE',
    author: 'Senator Jason Rarick',
    tags: ['INFRASTRUCTURE', 'ENVIRONMENT', 'PUBLIC FINANCE'],
  },
];

const CITIES = ['MINNEAPOLIS', 'SAINT PAUL', 'ROCHESTER', 'DULUTH', 'BLOOMINGTON', 'EDINA', 'ST. CLOUD', 'MANKATO'];

const NAV_ITEMS = [
  { label: 'Ask AI' },
  { label: 'Search', caret: true },
  { label: 'Track', caret: true },
  { label: 'About', caret: true },
];

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

export function HomeSignedOutScreen() {
  const { isDesktop, isMobile } = useResponsive();

  return (
    <PageBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.topZone}>
        <PageDots />
        {/* Mobile: sticky-style app header sits above the editorial meta stripe; desktop keeps the masthead-first order. */}
        {isMobile ? <TopNav items={NAV_ITEMS} /> : null}
        <MetaStripe
          left="ALETHICAL · CIVIC RECORD"
          right="VOL. 1 · 89TH SESSION · MARCH 21, 2026"
          rightMobile="89TH SESSION"
        />
        {!isMobile ? <TopNav items={NAV_ITEMS} /> : null}

        {/* Hero */}
        <Container style={styles.heroWrap}>
          {isWeb && !isMobile ? <View pointerEvents="none" style={heroGlowWeb} /> : null}
          <Eyebrow>TRUTH, UNCONCEALED</Eyebrow>
          <View style={[styles.heroRow, isDesktop && styles.heroRowDesktop]}>
            <View style={[styles.heroLeft, isDesktop && styles.heroLeftDesktop]}>
              <Text style={[styles.display, { fontSize: isDesktop ? t.fontSizes.heroXl : 44, lineHeight: isDesktop ? t.fontSizes.heroXl : 44 }]}>
                {/* Forced break after "answers" on both desktop and mobile (mobile is an
                    intentional exception to the mockup, which wraps after "on"). */}
                Grounded answers{'\n'}
                <Text style={{ color: t.colors.brand.deep }}>on Minnesota law</Text>
              </Text>
              <Text style={styles.subhead}>
                Minnesota legislative intelligence for search, tracking, and grounded bill questions — every answer
                traceable to the bill text it came from.
              </Text>

              <View style={[styles.askBar, isMobile && styles.askBarMobile, isMobile && askBarMobileWeb]}>
                <View style={[styles.askField, isMobile && styles.askFieldMobile]}>
                  <Search size={20} color={t.colors.text.muted} strokeWidth={2.2} />
                  <TextInput
                    style={styles.askInput}
                    placeholder="Ask about any bill, statute, or legislator…"
                    placeholderTextColor={t.colors.text.muted}
                    editable={false}
                  />
                </View>
                <PrimaryButton label="Ask" size="lg" />
              </View>
              <Text style={styles.noAccount}>NO ACCOUNT NEEDED TO SEARCH OR LOOK UP YOUR REP</Text>
            </View>

            <View style={[styles.heroRight, isDesktop && styles.heroRightDesktop]}>
              <Card style={isDesktop ? styles.answerCard : undefined}>
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
          </View>
        </Container>

        {/* What you can do */}
        <Container style={[styles.section, styles.sectionFirst]}>
          <SectionLabel>WHAT YOU CAN DO</SectionLabel>
          <View style={styles.infoRow}>
            <InfoCard icon="search" title="Search Bills" subtitle="Browse bills and legislators" />
            <InfoCard icon="map" title="Find My Legislator" subtitle="Address or map lookup" />
            <InfoCard icon="bookmark" title="Tracked Bills" subtitle="Signed-in watchlist" />
            <InfoCard icon="chat" title="Chat" subtitle="Ask cited questions" />
          </View>
        </Container>

        {/* Prototype account flow */}
        <Container style={styles.section}>
          <View style={[styles.protoPanel, isMobile && styles.protoPanelMobile, protoBgWeb]}>
            <View style={styles.protoText}>
              <Text style={styles.protoTitle}>Prototype account flow</Text>
              <Text style={styles.protoBody}>
                Public search and representative lookup work without an account. Sign in when you want tracking, saved
                history, and bill chat.
              </Text>
            </View>
            <GoogleButton />
          </View>
        </Container>
        </View>

        {/* Recent bills */}
        <Container style={styles.section}>
          <SectionHeading title="Recent Bills" actionLabel="VIEW ALL" />
          <View style={styles.billList}>
            {RECENT_BILLS.map((bill) => (
              <BillCard key={bill.billId} bill={bill} />
            ))}
          </View>
        </Container>

        {/* Find my legislator band */}
        <View style={[styles.findBand, findBgWeb]}>
          {isWeb ? <View pointerEvents="none" style={findDotsWeb} /> : null}
          <Container style={[styles.findInner, isDesktop && styles.findInnerDesktop]}>
            {!isDesktop ? (
              <View style={styles.findMapMobile}>
                <MNMap size={220} />
              </View>
            ) : null}
            <View style={[styles.findLeft, isDesktop ? styles.findLeftDesktop : styles.findLeftMobile]}>
              <Text style={[styles.findHeading, !isDesktop && styles.findHeadingMobile]}>Find My Legislator</Text>
              <Text style={[styles.findSubhead, !isDesktop && styles.centerText]}>
                Find your legislative representative to see their profile, committees, and authored bills — then ask
                anything about their record.
              </Text>
              <AddressField />
              <View style={[styles.cityRow, !isDesktop && styles.cityRowMobile]}>
                {CITIES.map((city) => (
                  <CityChip key={city} label={city} />
                ))}
              </View>
            </View>
            {isDesktop ? (
              <View style={styles.findMap}>
                <MNMap size={300} />
              </View>
            ) : null}
          </Container>
        </View>

        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 0 },
  topZone: { position: 'relative' },
  heroWrap: { paddingTop: 56, position: 'relative' },
  heroRow: { marginTop: 36, gap: 40 },
  heroRowDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroLeft: {},
  heroLeftDesktop: { flex: 1 },
  display: { fontFamily: t.typography.title, fontWeight: t.fontWeights.heavy, color: t.colors.text.primary, letterSpacing: -1 },
  subhead: { fontFamily: t.typography.body, fontSize: 23, lineHeight: 34, color: t.colors.text.muted, maxWidth: 580, marginTop: 36 },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: 14,
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 8,
    marginTop: 40,
    ...(t.shadows.card as object),
  },
  // Mobile: drop the wrapping card — input becomes its own bordered field, Ask sits separately below.
  askBarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingVertical: 0,
  },
  askField: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  askFieldMobile: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 2,
  },
  askInput: { flex: 1, minWidth: 0, fontFamily: t.typography.body, fontSize: t.fontSizes.bodyLg, color: t.colors.text.primary, paddingVertical: 12 },
  noAccount: { fontFamily: t.typography.ui, fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.medium, letterSpacing: 0.8, color: t.colors.text.muted, marginTop: 18, marginLeft: 18 },
  heroRight: {},
  heroRightDesktop: { flex: 1, alignItems: 'flex-end' },
  answerCard: { width: 600, maxWidth: '100%' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  sourcesCited: { fontFamily: t.typography.ui, fontSize: t.fontSizes.subhead, fontWeight: t.fontWeights.bold, color: t.colors.brand.darkest },
  answerBody: { fontFamily: t.typography.body, fontSize: t.fontSizes.bodyLg, lineHeight: 25, color: t.colors.text.primary },
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
  citationLabel: { flex: 1, minWidth: 0, fontFamily: t.typography.body, fontSize: t.fontSizes.body, color: t.colors.ink },
  citationPage: { fontFamily: t.typography.mono, fontSize: t.fontSizes.meta, color: t.colors.text.muted },
  section: { marginTop: 72, gap: 22 },
  sectionFirst: { marginTop: 96 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  protoPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 28,
    backgroundColor: t.colors.tint.t50,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 32,
  },
  protoPanelMobile: { flexDirection: 'column', alignItems: 'stretch' },
  protoText: { flex: 1, minWidth: 0, gap: 12 },
  protoTitle: { fontFamily: t.typography.title, fontSize: t.fontSizes.h1, fontWeight: t.fontWeights.heavy, letterSpacing: -0.6, color: t.colors.text.primary },
  protoBody: { fontFamily: t.typography.body, fontSize: t.fontSizes.subhead, lineHeight: 27, color: t.colors.text.secondary, maxWidth: 660 },
  billList: { gap: 20 },
  findBand: { position: 'relative', backgroundColor: t.colors.tint.t100, marginTop: 80, paddingVertical: 72 },
  findInner: { gap: 32 },
  findInnerDesktop: { flexDirection: 'row', alignItems: 'center', gap: 44 },
  findLeft: { gap: 22 },
  findLeftDesktop: { flex: 1.35 },
  findLeftMobile: { alignItems: 'center' },
  findHeading: { fontFamily: t.typography.title, fontSize: t.fontSizes.hero, fontWeight: t.fontWeights.heavy, letterSpacing: -1.4, color: t.colors.text.primary },
  findHeadingMobile: { fontSize: 40, textAlign: 'center', letterSpacing: -1 },
  findSubhead: { fontFamily: t.typography.body, fontSize: 22, lineHeight: 33, color: t.colors.text.secondary, maxWidth: 820 },
  centerText: { textAlign: 'center' },
  cityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, maxWidth: 640 },
  cityRowMobile: { justifyContent: 'center', width: '100%' },
  findMap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  findMapMobile: { alignItems: 'center', marginBottom: 4 },
});
