import type { ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';

import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import { useResponsive } from '../../hooks/useResponsive';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useCampaignFinanceSummary, useFeaturedBills } from '../../hooks/useAppQueries';
import type { MenuKey } from '../../navigation/ia';
import type { Bill } from '../../data/types';
import { HOME_PUBLIC_INTRO } from '../../lib/homepage';
import { loadOnDemand } from '../../lib/loadOnDemand';
import { SOCIAL_ACCOUNTS } from '../../lib/socialLinks';
import { isWeb } from '../billDetail/interactions';
import { MoneyPromoCard } from './MoneyPromoCard';
import { HomeFeatureCards } from './HomeFeatureCards';
import { HomeCandidateFinder } from './HomeCandidateFinder';

// The public services destination ships with this card.
export const HOME_SERVICES_READY = true;

const HeroSocialIconLink = loadOnDemand(
  () =>
    import('../SocialIconLink').then(({ SocialIconLink }) => ({
      default: SocialIconLink,
    })),
  { kind: 'optional' },
);

// The 7 accounts as quiet grey marks under the hero text. The row's size is fixed
// so the marks can arrive after the page without moving anything. Each link is
// pulled left so the first mark's ink starts 2px inside the text's left edge.
function HeroSocialRow({ phone, narrow }: { phone: boolean; narrow: boolean }) {
  const link = phone ? 44 : 40;
  const gap = phone ? 0 : 2;
  const perLine = narrow ? 4 : SOCIAL_ACCOUNTS.length;
  const lines = Math.ceil(SOCIAL_ACCOUNTS.length / perLine);
  return (
    <View
      accessibilityLabel="Social media"
      {...(isWeb ? ({ role: 'group' } as object) : {})}
      style={[
        s.heroSocial,
        {
          width: perLine * link + (perLine - 1) * gap,
          height: lines * link,
          columnGap: gap,
          // Optical correction, not a misalignment: a rounded mark flush with straight
          // letter edges reads as sticking out, so it sits 2px inside. Keep it.
          marginLeft: phone ? -9 : -8,
        },
      ]}
    >
      {SOCIAL_ACCOUNTS.map((social) => (
        <HeroSocialIconLink key={social.platform} social={social} surface="hero" mobile={phone} />
      ))}
    </View>
  );
}
const NEWS = ['94-2026-HF4138', '94-2025-SF856'];

/** September signed-out design, isolated from the pending signed-in redesign. */
export function SignedOutHomepage({
  renderExample,
  renderNews,
  servicesReady = HOME_SERVICES_READY,
}: {
  renderExample: (dimmed: boolean) => ReactNode;
  renderNews: (bill: Bill, onPress: () => void) => ReactNode;
  servicesReady?: boolean;
}) {
  const navigation = useNavigation<any>();
  const { width, isMobile, isTablet, isDesktop } = useResponsive();
  const isFocused = useIsFocused();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const summary = useCampaignFinanceSummary({ enabled: isFocused });
  const news = useFeaturedBills(NEWS, { enabled: isFocused && isMobile });
  const scroll = useHistoryScrollRestoration(isFocused && (!isMobile || !news.isLoading));
  const newsById = new Map(news.data?.map((bill) => [bill.id, bill]));
  const newsBills = NEWS.flatMap((key) => newsById.get(key) ?? []);
  const inset = isMobile ? 20 : isTablet ? 40 : 56;
  // Preserve the drawn 72px desktop/58px tablet/36px phone sizes at the
  // reference widths, shrinking only where the green line would otherwise clip.
  const headingSize = isDesktop
    ? Math.min(72, ((width - 208) / 1.72) * 0.089)
    : isTablet
      ? 58
      : Math.min(36, (width - 40) * 0.1);
  const invitationRow = <HomeFeatureCards servicesReady={servicesReady} />;
  const money = (
    <MoneyPromoCard
      variant={isMobile ? 'phoneSignedOut' : isTablet ? 'tabletSignedOut' : 'desktopSignedOut'}
      filerCount={summary.data?.register.filerCount ?? null}
      countLoading={summary.isLoading}
      dimmed={openMenu !== null}
      onPress={() => navigation.navigate('MoneyLanding')}
    />
  );

  return (
    <PageBackground>
      <ScrollView {...scroll} style={s.root} contentContainerStyle={s.content}>
        <View
          style={[
            s.hero,
            !isMobile &&
              (isWeb
                ? ({
                    backgroundImage:
                      'linear-gradient(180deg,#f4f5f7 0%,#f7f8fa 55%,#fdfdfe 90%,#ffffff 100%)',
                  } as object)
                : undefined),
          ]}
        >
          {!isMobile && isWeb ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundImage: t.gradients.dotInk,
                  backgroundSize: '30px 30px',
                  maskImage:
                    'linear-gradient(to bottom, transparent 110px, #000 230px, #000 calc(100% - 180px), transparent 100%)',
                } as object,
              ]}
            />
          ) : null}
          <TopNav
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
            onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
          />
          <Container
            style={{
              paddingHorizontal: inset,
              paddingTop: isMobile ? 36 : 64,
              paddingBottom: isMobile ? 56 : isTablet ? 80 : 96,
            }}
          >
            <View style={[s.heroRow, !isDesktop && s.heroStack]}>
              <View style={[s.heroCopy, isDesktop && { flex: 1 }]}>
                <Text
                  style={[
                    s.eyebrow,
                    {
                      fontSize: isMobile ? 21 : 15,
                      letterSpacing: isMobile ? 3.78 : 2.7,
                      marginBottom: isDesktop ? 36 : 30,
                    },
                  ]}
                >
                  TRUTH, UNCONCEALED
                </Text>
                <Text
                  {...(isFocused ? { accessibilityRole: 'header' as const, 'aria-level': 1 } : {})}
                  style={[
                    s.h1,
                    {
                      fontSize: headingSize,
                      lineHeight: headingSize * (isMobile ? 1.05 : isTablet ? 1.02 : 1),
                      letterSpacing: -headingSize * 0.02,
                    },
                  ]}
                >
                  Grounded answers{'\n'}
                  <Text style={s.green}>on Minnesota politics</Text>
                </Text>
                <Text
                  style={[
                    s.intro,
                    {
                      marginTop: isMobile ? 26 : isTablet ? 28 : 36,
                      fontSize: isDesktop ? 23 : 21,
                      lineHeight: isDesktop ? 34.5 : 31.5,
                    },
                  ]}
                >
                  {HOME_PUBLIC_INTRO}
                </Text>
                <View style={{ marginTop: isMobile ? 18 : isTablet ? 24 : 28 }}>
                  <HeroSocialRow phone={isMobile} narrow={width < 336} />
                </View>
              </View>
              {!isMobile ? (
                <View style={isDesktop ? s.moneyColumn : s.moneyTablet}>{money}</View>
              ) : null}
            </View>
          </Container>
        </View>
        {isMobile ? (
          <View
            style={[
              s.phoneBand,
              isWeb
                ? ({
                    backgroundImage:
                      'linear-gradient(180deg,#eaf6ef 0%,#f1f9f4 18%,#f8fbf9 60%,#ffffff 100%)',
                  } as object)
                : undefined,
            ]}
          >
            {money}
            {invitationRow}
          </View>
        ) : (
          <Container style={{ paddingHorizontal: inset }}>{invitationRow}</Container>
        )}
        <HomeCandidateFinder onNavigate={() => navigation.navigate('Candidates')} />
        {!isMobile ? (
          <Container
            style={{
              paddingHorizontal: inset,
              paddingTop: isTablet ? 80 : 96,
              paddingBottom: isTablet ? 80 : 96,
            }}
          >
            <Text accessibilityRole="header" aria-level={2} style={s.exampleLabel}>
              What an answer looks like
            </Text>
            <Text
              style={[
                s.exampleQuestion,
                { fontSize: isTablet ? 30 : 34, lineHeight: isTablet ? 36 : 41 },
              ]}
            >
              What’s in the new social media law for kids?
            </Text>
            <View style={s.example}>{renderExample(openMenu !== null)}</View>
          </Container>
        ) : null}
        {isMobile && (news.isLoading || newsBills.length > 0) ? (
          <Container style={s.news}>
            <Text accessibilityRole="header" aria-level={2} style={s.newsLabel}>
              In the news
            </Text>
            <View style={s.newsStack}>
              {news.isLoading
                ? NEWS.map((key) => (
                    <View
                      key={key}
                      aria-busy
                      accessibilityLabel="Loading news bill"
                      style={s.newsSkeleton}
                    />
                  ))
                : newsBills.map((bill) => (
                    <View key={bill.id}>
                      {renderNews(bill, () =>
                        navigation.navigate('BillDetail', { billId: bill.id }),
                      )}
                    </View>
                  ))}
            </View>
          </Container>
        ) : null}
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fbfcfd' },
  content: { flexGrow: 1 },
  hero: { position: 'relative', backgroundColor: '#ffffff' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 96 },
  heroStack: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  heroCopy: { minWidth: 0 },
  heroSocial: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  moneyColumn: { flex: 0.72, minWidth: 0 },
  moneyTablet: { marginTop: 48 },
  eyebrow: { fontFamily: t.typography.ui, fontWeight: '500', color: '#0f7a45' },
  h1: { fontFamily: t.typography.title, fontWeight: '800', color: '#11150f' },
  green: { color: '#149d5b' },
  intro: { fontFamily: t.typography.body, color: '#6b716b', maxWidth: 640 },
  phoneBand: {
    paddingTop: 40,
    paddingHorizontal: 20,
    paddingBottom: 56,
    gap: 24,
    backgroundColor: '#eaf6ef',
  },
  exampleLabel: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.6,
    color: '#0f7a45',
    textTransform: 'uppercase',
  },
  exampleQuestion: {
    marginTop: 14,
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.68,
    color: '#11150f',
  },
  example: { marginTop: 28 },
  news: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 56 },
  newsLabel: {
    fontFamily: t.typography.ui,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 4.2,
    color: '#0f7a45',
    textTransform: 'uppercase',
    marginBottom: 20,
  },
  newsStack: { gap: 18 },
  newsSkeleton: { height: 300, borderRadius: 20, backgroundColor: '#edf0ed' },
});
