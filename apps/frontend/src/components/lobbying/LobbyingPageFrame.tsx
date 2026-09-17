import React, { type CSSProperties, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useResponsive } from '../../hooks/useResponsive';
import {
  LOBBYING_RECORD_LOADING,
  LOBBYING_RECORD_UNAVAILABLE,
  lobbyingRecordNotFound,
} from '../../lib/lobbyingRecordCopy';
import type { ShareContent } from '../../lib/share';
import { linkProps, routePath } from '../../navigation/links';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme } from '../../theme/tokens';
import { SharePopover } from '../billDetail/SharePopover';

export function LobbyingPageFrame({
  eyebrow,
  title,
  details,
  shareContent,
  narrow = false,
  children,
  onBack,
  onHome,
}: {
  eyebrow?: string;
  title?: string;
  details?: ReactNode;
  shareContent?: ShareContent;
  narrow?: boolean;
  children: ReactNode;
  onBack: () => void;
  onHome: () => void;
}) {
  const { isMobile, isTablet } = useResponsive();
  const scrollRestoration = useHistoryScrollRestoration();
  return (
    <PageBackground>
      <ScrollView {...scrollRestoration} contentContainerStyle={styles.page}>
        <TopNav onHome={onHome} />
        <Container
          style={[
            styles.main,
            isTablet && styles.mainTablet,
            isMobile && styles.mainMobile,
            narrow && styles.mainNarrow,
            narrow && isTablet && styles.mainNarrowTablet,
            narrow && isMobile && styles.mainNarrowMobile,
          ]}
        >
          <Pressable {...linkProps(routePath.lobbying(), onBack)} style={styles.backLink}>
            <BackArrow />
            <Text style={styles.backLabel}>Back to Lobbying</Text>
          </Pressable>

          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          {title ? (
            <View style={[styles.headingRow, isMobile && styles.headingRowMobile]}>
              <View style={styles.headingCopy}>
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  style={[
                    styles.h1,
                    isTablet && styles.h1Tablet,
                    isMobile && styles.h1Mobile,
                    narrow && styles.h1Narrow,
                    narrow && isTablet && styles.h1NarrowTablet,
                    narrow && isMobile && styles.h1NarrowMobile,
                  ]}
                >
                  {title}
                </Text>
                {details}
              </View>
              {shareContent ? (
                <View style={narrow && isMobile ? styles.shareRowMobile : undefined}>
                  <SharePopover content={shareContent} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={title ? styles.body : styles.stateBody}>{children}</View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

export function LobbyingCard({
  label,
  title,
  scan = false,
  children,
}: {
  label: string;
  title: string;
  scan?: boolean;
  children: ReactNode;
}) {
  const { isMobile, isTablet } = useResponsive();
  const headingSize = scan
    ? isMobile
      ? 21
      : isTablet
        ? 24
        : 27
    : isMobile
      ? 20
      : isTablet
        ? 22
        : 24;
  const padding = scan
    ? isMobile
      ? '22px 18px 18px'
      : isTablet
        ? '26px 28px 22px'
        : '30px 34px 24px'
    : isMobile
      ? '20px 18px'
      : isTablet
        ? '26px 26px 24px'
        : '30px 32px 28px';
  return (
    <article
      aria-label={label}
      style={{
        ...card,
        ...(scan ? scanCard : null),
        padding,
      }}
    >
      <h2 style={{ ...cardHeading, ...(scan ? scanCardHeading : null), fontSize: headingSize }}>
        {title}
      </h2>
      {children}
    </article>
  );
}

export function LobbyingRecordState({
  state,
  identifier,
  onRetry,
}: {
  state: 'loading' | 'unavailable' | 'not-found';
  identifier?: string | null;
  onRetry?: () => void;
}) {
  const { isMobile } = useResponsive();
  const copy =
    state === 'loading'
      ? LOBBYING_RECORD_LOADING
      : state === 'not-found'
        ? lobbyingRecordNotFound(identifier)
        : LOBBYING_RECORD_UNAVAILABLE;
  return (
    <View
      accessibilityRole={state === 'unavailable' ? 'alert' : undefined}
      role={state === 'loading' ? 'status' : undefined}
      aria-busy={state === 'loading' || undefined}
      style={[styles.stateCard, isMobile && styles.stateCardMobile]}
    >
      <Text style={[styles.stateText, isMobile && styles.stateTextMobile]}>{copy}</Text>
      {state === 'unavailable' && onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BackArrow() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M15 5 L8 12 L15 19"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  marginTop: 22,
  background: '#ffffff',
  border: '1px solid rgba(17,21,15,0.08)',
  borderRadius: 16,
  boxShadow: '0 8px 24px rgba(17,21,15,0.05)',
  fontFamily: theme.typography.body,
  color: '#11150f',
};

const cardHeading: CSSProperties = {
  margin: 0,
  color: '#11150f',
  fontWeight: 800,
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
};

const scanCard: CSSProperties = {
  marginTop: 20,
  borderRadius: 18,
  boxShadow: '0 1px 2px rgba(17,21,15,0.04), 0 12px 28px rgba(17,21,15,0.05)',
};

const scanCardHeading: CSSProperties = {
  letterSpacing: '-0.02em',
  lineHeight: 1.16,
};

const styles: Record<string, any> = {
  page: { flexGrow: 1 },
  main: { paddingTop: 24, paddingBottom: 40 },
  mainTablet: { paddingTop: 24 },
  mainMobile: { paddingTop: 20, paddingBottom: 32 },
  mainNarrow: {
    maxWidth: 1032,
    alignSelf: 'center',
    paddingTop: 22,
    paddingBottom: 48,
  },
  mainNarrowTablet: {
    maxWidth: '100%',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 44,
  },
  mainNarrowMobile: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
  },
  backLink: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  backLabel: {
    color: '#4b524b',
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '600',
  },
  eyebrow: {
    marginTop: 14,
    color: '#0f7a45',
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.6,
    fontVariant: ['tabular-nums'],
  },
  headingRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
  },
  headingRowMobile: { gap: 16 },
  shareRowMobile: { width: '100%' },
  headingCopy: { flex: 1, minWidth: 0, maxWidth: 1000 },
  h1: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: -1.38,
    lineHeight: 49.7,
  },
  h1Tablet: { fontSize: 38, lineHeight: 41, letterSpacing: -1.14 },
  h1Mobile: { fontSize: 30, lineHeight: 32.4, letterSpacing: -0.9 },
  h1Narrow: { fontSize: 38, lineHeight: 40.3, letterSpacing: -1.14 },
  h1NarrowTablet: { fontSize: 34, lineHeight: 36, letterSpacing: -1.02 },
  h1NarrowMobile: { fontSize: 28, lineHeight: 29.7, letterSpacing: -0.84 },
  body: { marginTop: 4 },
  stateBody: { marginTop: 18 },
  stateCard: {
    minHeight: 180,
    padding: 32,
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
  },
  stateCardMobile: { minHeight: 150, padding: 20 },
  stateText: {
    maxWidth: 760,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 17,
    lineHeight: 26,
  },
  stateTextMobile: { fontSize: 16, lineHeight: 24 },
  retryButton: {
    marginTop: 18,
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ed47e',
    borderRadius: 12,
  },
  retryLabel: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
};
