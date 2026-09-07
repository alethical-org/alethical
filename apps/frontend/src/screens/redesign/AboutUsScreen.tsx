import { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { LinkArrow } from '../../components/LinkArrow';
import { useResponsive } from '../../hooks/useResponsive';
import {
  ABOUT_BELIEFS,
  ABOUT_BELIEFS_HEADING,
  ABOUT_CONTACT_HEADING,
  ABOUT_CONTACT_LINK,
  ABOUT_CORRECTION_PROMISE,
  ABOUT_EMAIL,
  ABOUT_FEEDBACK_LABEL,
  ABOUT_NAME_ORIGIN,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SOURCE_PROMISE,
  ABOUT_PAGE_SUBTITLE_LEAD,
  ABOUT_START_ITEMS,
  ABOUT_START_HEADING,
  ABOUT_WHY_HEADING,
  ABOUT_WHY_LINES,
} from '../../lib/aboutUs';
import { IaItem, MenuKey } from '../../navigation/ia';
import { linkProps, routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const ABOUT_COLORS = {
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
    roadmapTitle: 'Personalization built around you',
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

function StartCard({
  item,
  widthStyle,
  isMobile,
}: {
  item: StartCardItem;
  widthStyle: StyleProp<ViewStyle>;
  isMobile: boolean;
}) {
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
        <Text
          accessibilityRole="header"
          aria-level={3}
          style={[styles.cardTitle, isMobile && styles.startCardTitleMobile]}
        >
          {item.startTitle}
        </Text>
        <LinkArrow color={t.colors.text.primary} style={styles.cardTitleArrow} />
      </View>
      <Text style={[styles.cardBody, isMobile && styles.cardBodyMobile]}>{item.body}</Text>
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
  const startWidthStyle: StyleProp<ViewStyle> = isMobile
    ? [styles.fullWidth, styles.startCardMobile]
    : isTablet
      ? styles.twoColumn
      : styles.fourColumn;

  const handleNavigate = (item: IaItem) => {
    if (!navigateTopNavItem(navigation, item)) return;
    setOpenMenu(null);
  };

  const startItems: StartCardItem[] = ABOUT_START_ITEMS.map((item) => {
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
              {ABOUT_PAGE_HEADING}
            </Text>
            <Text style={[styles.heroSubtitle, isMobile && styles.heroSubtitleMobile]}>
              {ABOUT_PAGE_SUBTITLE_LEAD}
              <Text style={styles.provenanceText}>{ABOUT_PAGE_SOURCE_PROMISE}</Text>
            </Text>
          </View>

          <View style={[styles.originPanel, isMobile && styles.originPanelMobile]}>
            <Text style={[styles.originText, isMobile && styles.originTextMobile]}>
              {ABOUT_NAME_ORIGIN.beforeName}
              <Text style={styles.originTerm}>{ABOUT_NAME_ORIGIN.firstName}</Text>
              {ABOUT_NAME_ORIGIN.betweenNames}
              <Text style={styles.originTerm}>{ABOUT_NAME_ORIGIN.secondName}</Text>
              {ABOUT_NAME_ORIGIN.afterName}
            </Text>
          </View>
          {isMobile ? null : <View style={styles.originDivider} />}

          <View
            style={[styles.proseSection, styles.firstSection, isMobile && styles.mobileSection]}
          >
            <SectionTitle>{ABOUT_WHY_HEADING}</SectionTitle>
            {ABOUT_WHY_LINES.map((line) => (
              <Text key={line.text} style={line.lead ? styles.proseLead : styles.prose}>
                {line.text}
              </Text>
            ))}
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle>{ABOUT_BELIEFS_HEADING}</SectionTitle>
            <View style={[styles.cardGrid, isMobile && styles.cardGridMobile]}>
              {ABOUT_BELIEFS.map((belief) => (
                <View
                  key={belief.beliefTitle}
                  style={[styles.beliefCard, cardWidthStyle, isMobile && styles.beliefCardMobile]}
                >
                  <Text
                    accessibilityRole="header"
                    aria-level={3}
                    style={[
                      styles.cardTitle,
                      styles.beliefTitle,
                      isMobile && styles.beliefTitleMobile,
                    ]}
                  >
                    {belief.beliefTitle}
                  </Text>
                  <Text style={[styles.cardBody, isMobile && styles.cardBodyMobile]}>
                    {belief.body}
                  </Text>
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
            <SectionTitle>{ABOUT_START_HEADING}</SectionTitle>
            <View
              style={[styles.cardGrid, styles.startCardGrid, isMobile && styles.cardGridMobile]}
            >
              {startItems.map((item) => (
                <StartCard
                  key={item.startTitle}
                  item={item}
                  widthStyle={startWidthStyle}
                  isMobile={isMobile}
                />
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
              <SectionTitle>{ABOUT_CONTACT_HEADING}</SectionTitle>
              <Text style={styles.contactText}>
                {ABOUT_FEEDBACK_LABEL}{' '}
                <Text
                  accessibilityRole="link"
                  {...(Platform.OS === 'web' ? ({ href: `mailto:${ABOUT_EMAIL}` } as any) : {})}
                  onPress={
                    Platform.OS === 'web'
                      ? undefined
                      : () => void Linking.openURL(`mailto:${ABOUT_EMAIL}`)
                  }
                  style={styles.emailLink}
                >
                  {ABOUT_EMAIL}
                </Text>
              </Text>
              <Text style={styles.contactText}>{ABOUT_CORRECTION_PROMISE}</Text>
            </View>
            <Pressable
              {...linkProps(routePath.contactUs(), () => navigation.navigate('ContactUs'))}
              style={({ pressed }) => [
                styles.contactButton,
                isMobile && styles.contactButtonMobile,
                pressed && styles.contactButtonPressed,
              ]}
            >
              <Text style={styles.contactButtonText}>{ABOUT_CONTACT_LINK.label}</Text>
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
    backgroundColor: t.colors.cyan.surface,
    borderWidth: 1,
    borderColor: t.colors.cyan.border,
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
  originTerm: { color: t.colors.cyan.ink, fontWeight: t.fontWeights.bold },
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
  cardGridMobile: { gap: 12 },
  fullWidth: { width: '100%' },
  twoColumn: { width: '48%' },
  threeColumn: { width: '31.5%' },
  fourColumn: { width: '23.5%' },
  beliefCard: {
    backgroundColor: t.colors.cyan.surface,
    borderWidth: 1,
    borderColor: t.colors.cyan.border,
    borderRadius: 16,
    padding: 24,
    minHeight: 176,
  },
  beliefCardMobile: {
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 0,
  },
  cardTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: t.fontWeights.bold,
  },
  cardTitleArrow: { top: 0 },
  beliefTitle: { color: t.colors.cyan.ink },
  beliefTitleMobile: {
    fontSize: 15.5,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.08,
  },
  startCardTitleMobile: {
    fontSize: 16,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.16,
  },
  cardBody: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 10,
  },
  cardBodyMobile: { fontSize: 14.5, lineHeight: 22.5, marginTop: 6 },
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
  startCardMobile: {
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 0,
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
