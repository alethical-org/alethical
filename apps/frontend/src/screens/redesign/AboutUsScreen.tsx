import { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { LinkArrow } from '../../components/LinkArrow';
import { useResponsive } from '../../hooks/useResponsive';
import { IaItem, MenuKey } from '../../navigation/ia';
import { linkProps, routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const ABOUT_COLORS = {
  cyanSurface: '#f4fafc',
  cyanBorder: '#dbeef4',
  cyanInk: '#2b6377',
  roadmapSurface: '#f7f8fa',
  subtleBorder: 'rgba(17,21,15,0.09)',
  sectionRule: 'rgba(17,21,15,0.1)',
} as const;

const startCardFocus = Platform.select({
  web: { boxShadow: '0 0 0 3px #7c5cff, 0 14px 34px rgba(17,21,15,0.10)' },
  default: {
    shadowColor: '#7c5cff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 5,
    elevation: 4,
  },
}) as ViewStyle;

const BELIEFS = [
  {
    beliefTitle: 'Facts before opinions',
    body: 'We show what the public record says. We do not tell you what to think or whom to support.',
  },
  {
    beliefTitle: 'Sources you can check',
    body: 'Every important fact leads back to its source. If we cannot verify something, we say we do not know.',
  },
  {
    beliefTitle: 'Clear for anyone',
    body: 'You should not need a law degree, a job in politics, or the right vocabulary to get started.',
  },
  {
    beliefTitle: 'The same rules for everyone',
    body: 'We use the same standards for every party, bill, and legislator. We do not score or rate people.',
  },
  {
    beliefTitle: 'Your judgment stays yours',
    body: 'We help you understand what happened or what is being proposed. You decide what it means to you.',
  },
  {
    beliefTitle: 'Built for answers, not attention',
    body: 'There is no endless feed. Come with a question. Leave when you have what you need.',
  },
] as const;

const START_ITEMS = [
  {
    startTitle: 'Bills',
    body: 'Search Minnesota bills and narrow the results to what matters to you.',
    destination: 'bills',
  },
  {
    startTitle: 'Legislators',
    body: 'Find any current Minnesota legislator, explore their public record, and see how to contact them.',
    destination: 'legislators',
  },
  {
    startTitle: 'Find My Legislator',
    body: 'See who represents you in the Minnesota House and Senate, and learn about their work and how to contact them.',
    destination: 'findMyLegislator',
  },
  {
    startTitle: 'Track',
    body: 'Follow the bills that matter to you and see what changes.',
    destination: 'track',
  },
] as const;

const ROADMAP_ITEMS = [
  {
    roadmapTitle: 'Candidates, campaigns, and money',
    body: 'See who is running, the public record behind each campaign, and money in and out by year and source. Follow documented funding and lobbying activity alongside bills, votes, and results.',
  },
  {
    roadmapTitle: 'Grounded Ask',
    body: 'Ask AI freeform questions about bills, legislators, candidates, campaign finance, and more. Get answers with cited sources.',
  },
  {
    roadmapTitle: 'Claimed Profiles',
    body: 'Legislators and candidates can claim their profiles and speak in their own words. Legislators can explain their votes, and candidates can explain their positions, clearly labeled and kept separate from the official record.',
  },
  {
    roadmapTitle: 'A homepage built around you',
    body: 'Keep your legislators, saved bills, and followed topics in one place. Get website and email updates when something changes or a new bill matches an issue you follow.',
  },
  {
    roadmapTitle: 'News connected to the Legislature',
    body: 'Explore Minnesota political news in its own section, follow hot topics, and see stories connected to the bills they cover.',
  },
  {
    roadmapTitle: 'A more complete public record',
    body: 'Search past legislative sessions, see full voting records and bill co-authors, read explanations legislators choose to add, and jump from citations to exact official passages.',
  },
] as const;

type StartCardItem = {
  startTitle: string;
  body: string;
  href: string;
  onPress: () => void;
};

function StartCard({ item, widthStyle }: { item: StartCardItem; widthStyle: ViewStyle }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...linkProps(item.href, item.onPress)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.startCard,
        widthStyle,
        hovered && styles.startCardHovered,
        focused && styles.startCardFocused,
        pressed && styles.startCardPressed,
      ]}
    >
      <View style={styles.startCardHeader}>
        <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>
          {item.startTitle}
        </Text>
        <LinkArrow color={t.colors.text.primary} />
      </View>
      <Text style={styles.cardBody}>{item.body}</Text>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function AboutUsScreen({ navigation }: RootScreenProps<'AboutUs'>) {
  const { isMobile, isTablet } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const cardWidthStyle: ViewStyle = isMobile
    ? styles.fullWidth
    : isTablet
      ? styles.twoColumn
      : styles.threeColumn;
  const startWidthStyle: ViewStyle = isMobile
    ? styles.fullWidth
    : isTablet
      ? styles.twoColumn
      : styles.fourColumn;

  const handleNavigate = (item: IaItem) => {
    if (!navigateTopNavItem(navigation, item)) return;
    setOpenMenu(null);
  };

  const startItems: StartCardItem[] = START_ITEMS.map((item) => {
    switch (item.destination) {
      case 'bills':
        return {
          ...item,
          href: routePath.bills(),
          onPress: () => navigation.navigate('Bills'),
        };
      case 'legislators':
        return {
          ...item,
          href: routePath.legislators(),
          onPress: () => navigation.navigate('Legislators'),
        };
      case 'findMyLegislator':
        return {
          ...item,
          href: routePath.findMyLegislator(),
          onPress: () => navigation.navigate('FindMyLegislator'),
        };
      case 'track':
        return {
          ...item,
          href: routePath.tracked(),
          onPress: () => navigation.navigate('Tabs', { screen: 'Tracked' }),
        };
    }
  });

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={handleNavigate}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
        />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.heroTitle, isMobile && styles.heroTitleMobile]}
            >
              TRUTH, UNCONCEALED
            </Text>
            <Text style={[styles.heroSubtitle, isMobile && styles.heroSubtitleMobile]}>
              Minnesota’s public record, in everyday words and{' '}
              <Text style={styles.provenanceText}>linked to the source.</Text>
            </Text>
          </View>

          <View style={[styles.originPanel, isMobile && styles.originPanelMobile]}>
            <Text style={[styles.originText, isMobile && styles.originTextMobile]}>
              Alethical comes from <Text style={styles.originTerm}>aletheia</Text>, an ancient Greek
              word for truth brought into the open, and{' '}
              <Text style={styles.originTerm}>ethical</Text>, our promise to handle that truth with
              care.
            </Text>
          </View>
          {isMobile ? null : <View style={styles.originDivider} />}

          <View
            style={[styles.proseSection, styles.firstSection, isMobile && styles.mobileSection]}
          >
            <SectionTitle>Why we’re doing this</SectionTitle>
            <Text style={styles.prose}>
              Government records belong to everyone. Understanding them should not require knowing
              how the Legislature works.
            </Text>
            <Text style={styles.prose}>
              Minnesota publishes bills, votes, authors, committee actions, and more. The
              information is public. But it is spread across many pages and written in the language
              of lawmaking. A bill may look like a number, a list of steps, and pages of changes to
              laws you have never read.
            </Text>
            <Text style={styles.proseLead}>
              That can make a simple question hard to answer: What would this bill do?
            </Text>
            <Text style={styles.prose}>
              Alethical brings the pieces together and makes them easier to read. We use plain
              language, show where the facts came from, and keep a clear link to the official
              record. If the record cannot answer a question, neither do we.
            </Text>
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle>What we believe</SectionTitle>
            <View style={styles.cardGrid}>
              {BELIEFS.map((belief) => (
                <View
                  key={belief.beliefTitle}
                  style={[styles.beliefCard, cardWidthStyle, isMobile && styles.beliefCardMobile]}
                >
                  <Text
                    accessibilityRole="header"
                    aria-level={3}
                    style={[styles.cardTitle, styles.beliefTitle]}
                  >
                    {belief.beliefTitle}
                  </Text>
                  <Text style={styles.cardBody}>{belief.body}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.proseSection, isMobile && styles.mobileSection]}>
            <SectionTitle>What we’re working toward</SectionTitle>
            <Text style={styles.proseLead}>
              A Minnesota where anyone can check the public record for themselves.
            </Text>
            <Text style={styles.prose}>
              You hear about a bill that may affect your family, work, school, business, or
              community. You find it, read what it would do in everyday words, see where it stands
              and view any recorded votes, with the official record linked throughout.
            </Text>
            <Text style={styles.prose}>
              You never have to rely on a headline, a social post, or Alethical alone.
            </Text>
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle>Where to start</SectionTitle>
            <View style={[styles.cardGrid, styles.startCardGrid]}>
              {startItems.map((item) => (
                <StartCard key={item.startTitle} item={item} widthStyle={startWidthStyle} />
              ))}
            </View>
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle>On the roadmap</SectionTitle>
            <View style={[styles.roadmapPanel, isMobile && styles.roadmapPanelMobile]}>
              <View style={styles.cardGrid}>
                {ROADMAP_ITEMS.map((item) => (
                  <View
                    key={item.roadmapTitle}
                    style={[
                      styles.roadmapItem,
                      cardWidthStyle,
                      isMobile && styles.roadmapItemMobile,
                    ]}
                  >
                    <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>
                      {item.roadmapTitle}
                    </Text>
                    <Text style={styles.cardBody}>{item.body}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={styles.roadmapQuestion}>
              Which features matter most to you? Tell us what you want us to build first, and what
              we are missing.
            </Text>
          </View>

          <View
            style={[
              styles.contactSection,
              isMobile && styles.mobileSection,
              isMobile && styles.contactSectionMobile,
            ]}
          >
            <View style={styles.contactCopy}>
              <SectionTitle>Contact</SectionTitle>
              <Text style={styles.contactText}>
                Feedback:{' '}
                <Text
                  accessibilityRole="link"
                  {...(Platform.OS === 'web' ? ({ href: 'mailto:ask@alethical.com' } as any) : {})}
                  onPress={
                    Platform.OS === 'web'
                      ? undefined
                      : () => void Linking.openURL('mailto:ask@alethical.com')
                  }
                  style={styles.emailLink}
                >
                  ask@alethical.com
                </Text>
              </Text>
              <Text style={styles.contactText}>
                Think we got something wrong? Please tell us. Corrections come first.
              </Text>
            </View>
            <Pressable
              {...linkProps(routePath.contactUs(), () => navigation.navigate('ContactUs'))}
              style={({ pressed }) => [
                styles.contactButton,
                isMobile && styles.contactButtonMobile,
                pressed && styles.contactButtonPressed,
              ]}
            >
              <Text style={styles.contactButtonText}>Contact us</Text>
              <LinkArrow color={t.colors.brand.darkest} />
            </Pressable>
          </View>
        </Container>

        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: t.colors.surfaces.base },
  main: { maxWidth: 1248, alignSelf: 'center', paddingTop: 74, paddingBottom: 48 },
  mainMobile: { paddingTop: 42, paddingBottom: 34, paddingHorizontal: 20 },
  hero: { maxWidth: 930, marginBottom: 52 },
  heroMobile: { marginBottom: 34 },
  heroTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 58,
    lineHeight: 62,
    fontWeight: t.fontWeights.black,
    letterSpacing: -1.74,
  },
  heroTitleMobile: { fontSize: 34, lineHeight: 38, letterSpacing: -1.02 },
  heroSubtitle: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 24,
    lineHeight: 36,
    fontWeight: t.fontWeights.medium,
    marginTop: 18,
    maxWidth: 810,
  },
  heroSubtitleMobile: { fontSize: 18, lineHeight: 27, marginTop: 14 },
  provenanceText: { color: t.colors.purple.base },
  originPanel: {
    backgroundColor: ABOUT_COLORS.cyanSurface,
    borderWidth: 1,
    borderColor: ABOUT_COLORS.cyanBorder,
    borderRadius: 16,
    paddingHorizontal: 34,
    paddingVertical: 30,
  },
  originPanelMobile: {
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  originText: {
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 20,
    lineHeight: 32,
    fontWeight: t.fontWeights.medium,
    maxWidth: 1040,
  },
  originTextMobile: { fontSize: 16, lineHeight: 25 },
  originTerm: { color: ABOUT_COLORS.cyanInk, fontWeight: t.fontWeights.bold },
  originDivider: {
    marginTop: 40,
    height: 1,
    backgroundColor: ABOUT_COLORS.sectionRule,
  },
  firstSection: { marginTop: 44 },
  section: { marginTop: 56 },
  proseSection: { marginTop: 56 },
  mobileSection: {
    marginTop: 34,
    paddingTop: 26,
    borderTopWidth: 1,
    borderTopColor: ABOUT_COLORS.sectionRule,
  },
  sectionTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  prose: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 30,
    marginBottom: 16,
  },
  proseLead: {
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 21,
    lineHeight: 30,
    fontWeight: t.fontWeights.bold,
    marginTop: 6,
    marginBottom: 16,
  },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  startCardGrid: { gap: 16 },
  fullWidth: { width: '100%' },
  twoColumn: { width: '48%' },
  threeColumn: { width: '31.5%' },
  fourColumn: { width: '23.5%' },
  beliefCard: {
    backgroundColor: ABOUT_COLORS.cyanSurface,
    borderWidth: 1,
    borderColor: ABOUT_COLORS.cyanBorder,
    borderRadius: 16,
    padding: 24,
    minHeight: 176,
  },
  beliefCardMobile: { borderRadius: 14 },
  cardTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: t.fontWeights.bold,
  },
  beliefTitle: { color: ABOUT_COLORS.cyanInk },
  cardBody: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 10,
  },
  startCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: ABOUT_COLORS.sectionRule,
    borderRadius: 14,
    padding: 22,
    minHeight: 172,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 6px 18px rgba(17,21,15,0.05)' } as object)
      : (t.shadows.card as object)),
    ...(Platform.OS === 'web' && !prefersReducedMotion()
      ? ({
          transitionProperty: 'border-color, box-shadow',
          transitionDuration: '160ms',
          transitionTimingFunction: 'ease',
        } as object)
      : null),
  },
  startCardHovered: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 14px 34px rgba(17,21,15,0.10)' } as object)
      : (t.shadows.lg as object)),
  },
  startCardFocused: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...startCardFocus,
  },
  startCardPressed: { opacity: 0.76 },
  startCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
  },
  roadmapPanel: {
    backgroundColor: ABOUT_COLORS.roadmapSurface,
    borderWidth: 1,
    borderColor: ABOUT_COLORS.subtleBorder,
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 30,
  },
  roadmapPanelMobile: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  roadmapItem: { minHeight: 186, paddingRight: 12, paddingBottom: 8 },
  roadmapItemMobile: { minHeight: 0, paddingRight: 0, paddingBottom: 0 },
  roadmapQuestion: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 27,
    marginTop: 18,
    paddingLeft: 17,
  },
  contactSection: {
    alignItems: 'flex-start',
    gap: 22,
    marginTop: 56,
    paddingTop: 34,
    borderTopWidth: 1,
    borderTopColor: ABOUT_COLORS.sectionRule,
  },
  contactSectionMobile: { gap: 18 },
  contactCopy: { width: '100%' },
  contactText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    marginTop: 4,
  },
  contactButton: {
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    minWidth: 138,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.brand.base,
    borderRadius: 11,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  contactButtonMobile: { width: '100%', minHeight: 48 },
  contactButtonPressed: { backgroundColor: t.colors.brand.hover, transform: [{ scale: 0.98 }] },
  contactButtonText: {
    color: t.colors.brand.darkest,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
  emailLink: { color: t.colors.text.greenOnLight, fontWeight: t.fontWeights.bold },
});
