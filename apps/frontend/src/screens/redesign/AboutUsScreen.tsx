import { useState } from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { LinkArrowLabel } from '../../components/LinkArrow';
import { useResponsive } from '../../hooks/useResponsive';
import {
  ABOUT_BELIEFS,
  ABOUT_BELIEFS_HEADING,
  ABOUT_CONTACT_HEADING,
  ABOUT_CONTACT_LABEL,
  ABOUT_CORRECTION_PROMISE,
  ABOUT_DOES_HEADING,
  ABOUT_EMAIL,
  ABOUT_NAME_ORIGIN,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SUBTITLE,
  ABOUT_PLATFORM_HEADING,
  ABOUT_PLATFORM_INTRO,
  ABOUT_PLATFORM_ITEMS,
  ABOUT_ROADMAP_HEADING,
  ABOUT_ROADMAP_INVITATION,
  ABOUT_ROADMAP_ITEMS,
  ABOUT_SERVICES_HEADING,
  ABOUT_SERVICES_INTRO,
  ABOUT_SERVICES_ITEM,
  ABOUT_TEAM_HEADING,
  ABOUT_TEAM_MEMBERS,
  ABOUT_TRACK_SIGNED_IN,
  ABOUT_WHY_HEADING,
  ABOUT_WHY_LINES,
  ABOUT_WRITING_HEADING,
  ABOUT_WRITING_INTRO,
  ABOUT_WRITING_ITEMS,
} from '../../lib/aboutUs';
import { eventIndexBySlug } from '../../lib/eventsIndex';
import { IaItem, MenuKey } from '../../navigation/ia';
import { linkProps, routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

const ABOUT_COLORS = {
  roadmapSurface: '#f7f8fa',
  subtleBorder: 'rgba(17,21,15,0.09)',
  sectionRule: 'rgba(17,21,15,0.1)',
} as const;

type OfferLinkItem = {
  title: string;
  body: string;
  href: string;
  onPress: () => void;
  /** The debate link shows the event's photo under its description. */
  photo?: boolean;
};

const DEBATE_EVENT = eventIndexBySlug('forward-debate-2026');

const TEAM_PORTRAITS = [
  require('../../../assets/team/angel-zierden.jpg'),
  require('../../../assets/team/eugene-lopin.jpg'),
] as const;

type TeamMember = (typeof ABOUT_TEAM_MEMBERS)[number];

function TeamMemberCard({
  member,
  portrait,
  isMobile,
  isTablet,
}: {
  member: TeamMember;
  portrait: (typeof TEAM_PORTRAITS)[number];
  isMobile: boolean;
  isTablet: boolean;
}) {
  const identity = (
    <View style={styles.teamIdentity}>
      <Text
        accessibilityRole="header"
        aria-level={3}
        style={[
          styles.teamName,
          isTablet && styles.teamNameTablet,
          isMobile && styles.teamNameMobile,
        ]}
      >
        {member.name}
      </Text>
      <Text
        style={[
          styles.teamRole,
          isTablet && styles.teamRoleTablet,
          isMobile && styles.teamRoleMobile,
        ]}
      >
        {member.title}
      </Text>
    </View>
  );

  const biography = (
    <View
      style={[styles.teamBio, isTablet && styles.teamBioTablet, isMobile && styles.teamBioMobile]}
    >
      {member.bio.map((paragraph) => (
        <Text
          key={paragraph}
          style={[
            styles.teamBioText,
            isTablet && styles.teamBioTextTablet,
            isMobile && styles.teamBioTextMobile,
          ]}
        >
          {paragraph}
        </Text>
      ))}
    </View>
  );

  const portraitImage = (
    <View
      accessibilityRole="image"
      accessibilityLabel={member.name}
      style={[
        styles.teamPortrait,
        isTablet && styles.teamPortraitTablet,
        isMobile && styles.teamPortraitMobile,
      ]}
    >
      <Image
        accessible={false}
        source={portrait}
        resizeMode="cover"
        style={styles.teamPortraitImage}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.teamCard,
        isTablet && styles.teamCardTablet,
        isMobile && styles.teamCardMobile,
      ]}
    >
      {isTablet ? (
        <>
          {portraitImage}
          <View style={styles.teamTabletContent}>
            {identity}
            {biography}
          </View>
        </>
      ) : (
        <>
          <View style={[styles.teamHeader, isMobile && styles.teamHeaderMobile]}>
            {portraitImage}
            {identity}
          </View>
          {biography}
        </>
      )}
    </View>
  );
}

function EmailLink({ canHover }: { canHover: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Text
      accessibilityRole="link"
      {...(Platform.OS === 'web'
        ? ({
            href: `mailto:${ABOUT_EMAIL}`,
            tabIndex: 0,
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          } as any)
        : {})}
      onPress={
        Platform.OS === 'web' ? undefined : () => void Linking.openURL(`mailto:${ABOUT_EMAIL}`)
      }
      style={[styles.emailLink, canHover && hovered && styles.emailLinkHovered]}
    >
      {ABOUT_EMAIL}
    </Text>
  );
}

/** The shipped homepage photograph of The Forward Debate, decorative beside its link. */
function DebatePhoto({ narrow }: { narrow: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!DEBATE_EVENT || failed) return null;
  const src = narrow ? DEBATE_EVENT.homePhotos.narrow : DEBATE_EVENT.homePhotos.desktop;
  return (
    <View style={styles.photo}>
      {Platform.OS === 'web' ? (
        <img src={src} alt="" onError={() => setFailed(true)} style={photoImageStyle} />
      ) : (
        <Image
          accessible={false}
          source={{ uri: src }}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={styles.photoImage}
        />
      )}
    </View>
  );
}

function OfferLink({
  item,
  canHover,
  isMobile,
  narrowPhoto,
}: {
  item: OfferLinkItem;
  canHover: boolean;
  isMobile: boolean;
  narrowPhoto: boolean;
}) {
  return (
    <View style={styles.offerItem}>
      <Pressable {...linkProps(item.href, item.onPress)} style={styles.offerLink}>
        {(state) => (
          <LinkArrowLabel
            label={item.title}
            style={[
              styles.offerLinkText,
              isMobile && styles.offerLinkTextMobile,
              canHover &&
                Boolean('hovered' in state && state.hovered) &&
                styles.offerLinkTextHovered,
            ]}
          />
        )}
      </Pressable>
      <Text style={[styles.offerBody, isMobile && styles.offerBodyMobile]}>{item.body}</Text>
      {item.photo ? <DebatePhoto narrow={narrowPhoto} /> : null}
    </View>
  );
}

function OfferRow({
  heading,
  intro,
  items,
  isMobile,
  isTablet,
  canHover,
}: {
  heading: string;
  intro: string;
  items: OfferLinkItem[];
  isMobile: boolean;
  isTablet: boolean;
  canHover: boolean;
}) {
  const stacked = isMobile || isTablet;
  return (
    <View style={[styles.offerRow, stacked && styles.offerRowStacked]}>
      <View style={[styles.offerIntro, stacked && styles.offerIntroStacked]}>
        <Text
          accessibilityRole="header"
          aria-level={3}
          style={[styles.offerHeading, isMobile && styles.offerHeadingMobile]}
        >
          {heading}
        </Text>
        <Text style={[styles.offerIntroText, isMobile && styles.offerBodyMobile]}>{intro}</Text>
      </View>
      <View style={[styles.offerLinks, isMobile && styles.offerLinksMobile]}>
        {items.map((item) => (
          <View key={item.title} style={isMobile ? styles.fullWidth : styles.offerLinkColumn}>
            <OfferLink item={item} canHover={canHover} isMobile={isMobile} narrowPhoto={stacked} />
          </View>
        ))}
      </View>
    </View>
  );
}

function ContactButton({
  href,
  onPress,
  isMobile,
  canHover,
}: {
  href: string;
  onPress: () => void;
  isMobile: boolean;
  canHover: boolean;
}) {
  return (
    <Pressable
      {...linkProps(href, onPress)}
      style={(state) => [
        styles.contactButton,
        isMobile && styles.contactButtonMobile,
        canHover && Boolean('hovered' in state && state.hovered) && styles.contactButtonHovered,
        state.pressed && styles.contactButtonPressed,
      ]}
    >
      <Text style={styles.contactButtonText}>{ABOUT_CONTACT_LABEL}</Text>
    </Pressable>
  );
}

function SectionTitle({
  children,
  isMobile,
  isTablet,
  style,
}: {
  children: string;
  isMobile: boolean;
  isTablet: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={2}
      style={[
        styles.sectionTitle,
        isTablet && styles.sectionTitleTablet,
        isMobile && styles.sectionTitleMobile,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function AboutUsScreen({ navigation }: RootScreenProps<'AboutUs'>) {
  const { isMobile, isTablet } = useResponsive();
  const { isSignedIn } = useAuth();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const canHover = Boolean(
    Platform.OS === 'web' &&
    !isMobile &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches,
  );
  const cardWidthStyle: ViewStyle = isMobile
    ? styles.fullWidth
    : isTablet
      ? styles.twoColumn
      : styles.threeColumn;

  const handleNavigate = (item: IaItem) => {
    if (!navigateTopNavItem(navigation, item)) return;
    setOpenMenu(null);
  };

  const platformItems: OfferLinkItem[] = ABOUT_PLATFORM_ITEMS.map((item) => {
    switch (item.destination) {
      case 'bills':
        return { ...item, href: routePath.bills(), onPress: () => navigation.navigate('Bills') };
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
      case 'candidates':
        return { ...item, onPress: () => navigation.navigate('Candidates') };
      case 'money':
        return {
          ...item,
          href: routePath.money(),
          onPress: () => navigation.navigate('MoneyLanding'),
        };
      case 'track':
        return {
          ...item,
          body: isSignedIn ? ABOUT_TRACK_SIGNED_IN : item.body,
          href: routePath.tracked(),
          onPress: () => navigation.navigate('Tabs', { screen: 'Tracked' }),
        };
    }
  });
  const writingItems: OfferLinkItem[] = ABOUT_WRITING_ITEMS.map((item) =>
    item.destination === 'blog'
      ? { ...item, href: routePath.read(), onPress: () => navigation.navigate('Read') }
      : {
          ...item,
          photo: true,
          onPress: () => navigation.navigate('Event', { slug: 'forward-debate-2026' }),
        },
  );
  const servicesItems: OfferLinkItem[] = [
    {
      ...ABOUT_SERVICES_ITEM,
      href: routePath.services(),
      onPress: () => navigation.navigate('Services'),
    },
  ];
  const offerProps = { isMobile, isTablet, canHover };

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
              {ABOUT_PAGE_SUBTITLE}
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

          <View style={[styles.firstSection, isMobile && styles.mobileSection]}>
            <SectionTitle isMobile={isMobile} isTablet={isTablet}>
              {ABOUT_DOES_HEADING}
            </SectionTitle>
            <OfferRow
              heading={ABOUT_PLATFORM_HEADING}
              intro={ABOUT_PLATFORM_INTRO}
              items={platformItems}
              {...offerProps}
            />
            <OfferRow
              heading={ABOUT_WRITING_HEADING}
              intro={ABOUT_WRITING_INTRO}
              items={writingItems}
              {...offerProps}
            />
            <OfferRow
              heading={ABOUT_SERVICES_HEADING}
              intro={ABOUT_SERVICES_INTRO}
              items={servicesItems}
              {...offerProps}
            />
          </View>

          <View style={[styles.proseSection, isMobile && styles.mobileSection]}>
            <SectionTitle isMobile={isMobile} isTablet={isTablet}>
              {ABOUT_WHY_HEADING}
            </SectionTitle>
            {ABOUT_WHY_LINES.map((line) => (
              <Text key={line} style={[styles.prose, isMobile && styles.proseMobile]}>
                {line}
              </Text>
            ))}
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle isMobile={isMobile} isTablet={isTablet}>
              {ABOUT_BELIEFS_HEADING}
            </SectionTitle>
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

          <View
            style={[
              styles.section,
              isTablet && styles.teamSectionTablet,
              isMobile && styles.mobileSection,
            ]}
          >
            <SectionTitle
              isMobile={isMobile}
              isTablet={isTablet}
              style={[
                styles.teamSectionTitle,
                isTablet && styles.teamSectionTitleTablet,
                isMobile && styles.teamSectionTitleMobile,
              ]}
            >
              {ABOUT_TEAM_HEADING}
            </SectionTitle>
            <View
              style={[
                styles.teamGrid,
                (isTablet || isMobile) && styles.teamGridStacked,
                isTablet && styles.teamGridTablet,
                isMobile && styles.teamGridMobile,
              ]}
            >
              {ABOUT_TEAM_MEMBERS.map((member, index) => (
                <TeamMemberCard
                  key={member.name}
                  member={member}
                  portrait={TEAM_PORTRAITS[index]}
                  isMobile={isMobile}
                  isTablet={isTablet}
                />
              ))}
            </View>
          </View>

          <View style={[styles.section, isMobile && styles.mobileSection]}>
            <SectionTitle isMobile={isMobile} isTablet={isTablet}>
              {ABOUT_ROADMAP_HEADING}
            </SectionTitle>
            <View style={[styles.roadmapPanel, isMobile && styles.roadmapPanelMobile]}>
              <View style={[styles.cardGrid, isMobile && styles.cardGridMobile]}>
                {ABOUT_ROADMAP_ITEMS.map((item) => (
                  <View
                    key={item.title}
                    style={[
                      styles.roadmapItem,
                      cardWidthStyle,
                      isMobile && styles.roadmapItemMobile,
                    ]}
                  >
                    <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>
                      {item.title}
                    </Text>
                    <Text style={[styles.cardBody, isMobile && styles.cardBodyMobile]}>
                      {item.body}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.roadmapInvite, isMobile && styles.roadmapInviteMobile]}>
              <Text style={[styles.roadmapQuestion, isMobile && styles.roadmapQuestionMobile]}>
                {ABOUT_ROADMAP_INVITATION}
              </Text>
              <ContactButton
                href={routePath.contactUs({ purpose: 'feature-request' })}
                onPress={() => navigation.navigate('ContactUs', { purpose: 'feature-request' })}
                isMobile={isMobile}
                canHover={canHover}
              />
            </View>
          </View>

          <View
            style={[
              styles.contactSection,
              isMobile && styles.mobileSection,
              isMobile && styles.contactSectionMobile,
            ]}
          >
            <View style={styles.contactCopy}>
              <SectionTitle isMobile={isMobile} isTablet={isTablet}>
                {ABOUT_CONTACT_HEADING}
              </SectionTitle>
              <Text style={styles.contactText}>{ABOUT_CORRECTION_PROMISE}</Text>
              <Text style={[styles.contactText, styles.contactEmail]}>
                <EmailLink canHover={canHover} />
              </Text>
            </View>
            <ContactButton
              href={routePath.contactUs({ purpose: 'correction' })}
              onPress={() => navigation.navigate('ContactUs', { purpose: 'correction' })}
              isMobile={isMobile}
              canHover={canHover}
            />
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

const photoImageStyle = {
  display: 'block',
  width: '100%',
  height: 'auto',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
} as const;

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
    fontSize: 29,
    lineHeight: 35,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  sectionTitleTablet: { fontSize: 26, lineHeight: 31 },
  sectionTitleMobile: { fontSize: 22, lineHeight: 27 },
  teamSectionTablet: { marginTop: 48 },
  teamSectionTitle: { marginBottom: 26 },
  teamSectionTitleTablet: { marginBottom: 22 },
  teamSectionTitleMobile: { marginBottom: 18 },
  teamGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 18,
  },
  teamGridStacked: { flexDirection: 'column' },
  teamGridTablet: { gap: 16 },
  teamGridMobile: { gap: 12 },
  teamCard: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: ABOUT_COLORS.roadmapSurface,
    borderWidth: 1,
    borderColor: ABOUT_COLORS.subtleBorder,
    borderRadius: 16,
    paddingTop: 30,
    paddingHorizontal: 32,
    paddingBottom: 32,
  },
  teamCardTablet: {
    width: '100%',
    flexBasis: 'auto',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 28,
    paddingTop: 28,
    paddingHorizontal: 30,
    paddingBottom: 30,
  },
  teamCardMobile: {
    width: '100%',
    flexBasis: 'auto',
    borderRadius: 14,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  teamHeaderMobile: { gap: 16 },
  teamPortrait: {
    width: 128,
    height: 128,
    flexShrink: 0,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    backgroundColor: '#e9ebe8',
  },
  teamPortraitImage: { width: '100%', height: '100%' },
  teamPortraitTablet: { width: 148, height: 148 },
  teamPortraitMobile: { width: 84, height: 84, borderRadius: 10 },
  teamTabletContent: { flex: 1, minWidth: 0 },
  teamIdentity: { flex: 1, minWidth: 0 },
  teamName: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.23,
    ...(Platform.OS === 'web' ? ({ textWrap: 'pretty' } as object) : null),
  },
  teamNameTablet: { fontSize: 22, lineHeight: 27 },
  teamNameMobile: { fontSize: 19, lineHeight: 23 },
  teamRole: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16.5,
    lineHeight: 23,
    fontWeight: t.fontWeights.medium,
    marginTop: 6,
    ...(Platform.OS === 'web' ? ({ textWrap: 'pretty' } as object) : null),
  },
  teamRoleTablet: { fontSize: 16, lineHeight: 22 },
  teamRoleMobile: { fontSize: 14.5, lineHeight: 20, marginTop: 5 },
  teamBio: {
    marginTop: 24,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: ABOUT_COLORS.subtleBorder,
    gap: 14,
  },
  teamBioTablet: { marginTop: 20, paddingTop: 18, gap: 13 },
  teamBioMobile: { marginTop: 18, paddingTop: 16, gap: 12 },
  teamBioText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 27.5,
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'web' ? ({ textWrap: 'pretty' } as object) : null),
  },
  teamBioTextTablet: { fontSize: 16.5, lineHeight: 26.5 },
  teamBioTextMobile: { fontSize: 15, lineHeight: 24 },
  prose: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 30,
    marginBottom: 16,
  },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  cardGridMobile: { gap: 12 },
  fullWidth: { width: '100%' },
  twoColumn: { width: '48%' },
  threeColumn: { width: '31.5%' },
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
  beliefTitle: { color: t.colors.cyan.ink },
  beliefTitleMobile: {
    fontSize: 15.5,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.08,
  },
  cardBody: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 10,
  },
  cardBodyMobile: { fontSize: 14.5, lineHeight: 22.5, marginTop: 6 },
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
  contactButtonHovered: { backgroundColor: t.colors.brand.hover },
  contactButtonPressed: { backgroundColor: t.colors.brand.hover, transform: [{ scale: 0.98 }] },
  contactButtonText: {
    color: t.colors.brand.darkest,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
  firstSection: { marginTop: 44 },
  // The next section's phone divider already closes the facts.
  offerRow: {
    flexDirection: 'row',
    gap: 40,
    paddingTop: 28,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: ABOUT_COLORS.sectionRule,
  },
  offerRowStacked: { flexDirection: 'column', gap: 18, paddingTop: 22, paddingBottom: 24 },
  offerIntro: { flex: 1, minWidth: 0 },
  offerIntroStacked: { flex: 0 },
  offerHeading: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: t.fontWeights.heavy,
  },
  offerHeadingMobile: { fontSize: 18, lineHeight: 24 },
  offerIntroText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    marginTop: 8,
    maxWidth: 360,
  },
  offerLinks: {
    flex: 2,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 36,
    rowGap: 12,
  },
  offerLinksMobile: { flexDirection: 'column', rowGap: 10 },
  offerLinkColumn: { width: '46%', flexGrow: 1, minWidth: 0 },
  offerItem: { minWidth: 0 },
  offerLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  offerLinkText: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  offerLinkTextMobile: { fontSize: 16 },
  offerLinkTextHovered: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
  offerBody: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  offerBodyMobile: { fontSize: 14.5, lineHeight: 22.5 },
  photo: {
    marginTop: 14,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e9ebe8',
    aspectRatio: 16 / 9,
  },
  photoImage: { width: '100%', height: '100%' },
  proseMobile: { fontSize: 16, lineHeight: 26 },
  roadmapInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginTop: 18,
    paddingLeft: 17,
  },
  roadmapInviteMobile: { flexDirection: 'column', alignItems: 'stretch', gap: 14, paddingLeft: 0 },
  roadmapQuestion: {
    flex: 1,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 27,
  },
  roadmapQuestionMobile: { flex: 0, fontSize: 15.5, lineHeight: 24 },
  contactEmail: { marginTop: 8 },
  emailLink: { color: t.colors.text.greenOnLight, fontWeight: t.fontWeights.bold },
  emailLinkHovered: { color: '#11832b', textDecorationLine: 'underline' },
});
