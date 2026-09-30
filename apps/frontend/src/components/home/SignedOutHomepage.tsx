import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';

import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import { useResponsive } from '../../hooks/useResponsive';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useCampaignFinanceSummary, useFeaturedBills } from '../../hooks/useAppQueries';
import { linkProps, routePath } from '../../navigation/links';
import type { MenuKey } from '../../navigation/ia';
import type { Bill } from '../../data/types';
import {
  HOME_PUBLIC_INTRO,
  HOME_PUBLIC_BILLS_HEADING,
  HOME_PUBLIC_BILLS_BODY,
  HOME_PUBLIC_BILLS_CTA,
  HOME_PUBLIC_SERVICES_HEADING,
  HOME_PUBLIC_SERVICES_BODY,
  HOME_PUBLIC_SERVICES_CTA,
} from '../../lib/homepage';
import { LinkArrow, linkArrowRow } from '../LinkArrow';
import { isWeb, useFineHover } from '../billDetail/interactions';
import { MoneyPromoCard } from './MoneyPromoCard';

// Public service and candidate destinations have not launched. This gate is
// deliberately build-time, not a request to probe a broken destination on load.
// The services owner can enable the card with its working public route. Candidate
// lookup integration belongs to the candidate build and is absent until then.
export const HOME_SERVICES_READY = false;
const NEWS = ['94-2026-HF4138', '94-2025-SF856'];

function Invitation({
  heading,
  body,
  label,
  href,
  onPress,
  paid,
  phone,
}: {
  heading: string;
  body: string;
  label: string;
  href: string;
  onPress?: () => void;
  paid?: boolean;
  phone: boolean;
}) {
  const [hovered, hover] = useFineHover();
  const { isTablet } = useResponsive();
  return (
    <Pressable
      {...linkProps(href, onPress)}
      {...hover}
      style={[
        s.invitation,
        phone ? s.invitationPhone : isTablet ? s.invitationTablet : undefined,
        motion(),
        hovered && s.cardHover,
        hovered && !prefersReducedMotion() && { transform: [{ translateY: -3 }] },
      ]}
    >
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[
          s.cardHeading,
          {
            fontSize: phone ? 28 : isTablet ? 26 : 30,
            lineHeight: phone ? 31 : isTablet ? 30 : 34,
          },
        ]}
      >
        {heading}
      </Text>
      <Text style={[s.cardBody, phone && s.cardBodyPhone]}>{body}</Text>
      <View style={s.invitationAction}>
        <View
          style={[
            s.button,
            paid && s.buttonPaid,
            phone && s.buttonPhone,
            hovered && (paid ? s.buttonPaidHover : s.buttonHover),
          ]}
        >
          <View style={linkArrowRow}>
            <Text style={[s.buttonLabel, paid && s.buttonPaidLabel, phone && { fontSize: 19 }]}>
              {label}
            </Text>
            <LinkArrow color={paid ? '#ffffff' : '#0f7a45'} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const motion = (): object =>
  isWeb && !prefersReducedMotion()
    ? {
        transitionProperty: 'border-color, box-shadow, transform',
        transitionDuration: '0.16s',
        transitionTimingFunction: 'ease',
      }
    : {};

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
  const invitationRow = (
    <View style={[s.invitationRow, isMobile && s.invitationRowPhone]}>
      <Invitation
        heading={HOME_PUBLIC_BILLS_HEADING}
        body={HOME_PUBLIC_BILLS_BODY}
        label={HOME_PUBLIC_BILLS_CTA}
        href={routePath.bills()}
        onPress={() => navigation.navigate('Bills')}
        phone={isMobile}
      />
      {servicesReady ? (
        <Invitation
          heading={HOME_PUBLIC_SERVICES_HEADING}
          body={HOME_PUBLIC_SERVICES_BODY}
          label={HOME_PUBLIC_SERVICES_CTA}
          href="/services"
          paid
          phone={isMobile}
        />
      ) : null}
    </View>
  );
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
            signInAppearance="outline"
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
                      marginBottom: isMobile ? 30 : 36,
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
  moneyColumn: { flex: 0.72, minWidth: 0 },
  moneyTablet: { marginTop: 48 },
  eyebrow: { fontFamily: t.typography.ui, fontWeight: '500', color: '#0f7a45' },
  h1: { fontFamily: t.typography.title, fontWeight: '800', color: '#11150f' },
  green: { color: '#149d5b' },
  intro: { fontFamily: t.typography.body, color: '#6b716b', maxWidth: 640 },
  invitationRow: { flexDirection: 'row', alignItems: 'stretch', gap: 24 },
  invitationRowPhone: { flexDirection: 'column' },
  invitation: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 32,
    paddingBottom: 32,
    boxShadow: '0 18px 44px rgba(17,21,15,0.08)',
  },
  invitationTablet: { paddingTop: 30, paddingHorizontal: 28, paddingBottom: 28 },
  invitationPhone: {
    flexBasis: 'auto',
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 28,
    borderColor: 'rgba(17,21,15,0.10)',
    boxShadow: '0 10px 28px rgba(17,21,15,0.07)',
  },
  cardHeading: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#11150f',
  },
  cardBody: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: '#4f5651',
    maxWidth: 680,
  },
  cardBodyPhone: { fontSize: 21, lineHeight: 31.5 },
  invitationAction: { marginTop: 'auto', paddingTop: 28 },
  cardHover: { borderColor: 'rgba(45,212,126,0.85)', boxShadow: '0 22px 46px rgba(17,21,15,0.14)' },
  button: {
    alignSelf: 'flex-start',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPhone: {
    alignSelf: 'stretch',
    minHeight: 56,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  buttonPaid: { backgroundColor: '#11150f', borderColor: '#11150f' },
  buttonHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  buttonPaidHover: { backgroundColor: '#3a423b', borderColor: '#3a423b' },
  buttonLabel: { fontFamily: t.typography.ui, fontSize: 17, fontWeight: '700', color: '#11150f' },
  buttonPaidLabel: { color: '#ffffff' },
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
  news: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 48 },
  newsLabel: {
    fontFamily: t.typography.ui,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: '#0f7a45',
    textTransform: 'uppercase',
    marginBottom: 22,
  },
  newsStack: { gap: 16 },
  newsSkeleton: { height: 300, borderRadius: 20, backgroundColor: '#edf0ed' },
});
