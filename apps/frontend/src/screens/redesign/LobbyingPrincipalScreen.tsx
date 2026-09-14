import React, { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import {
  LobbyingPageFrame,
  LobbyingCard,
  LobbyingRecordState,
} from '../../components/lobbying/LobbyingPageFrame';
import { PrincipalLobbyistsCard } from '../../components/lobbying/LobbyingRecordCards';
import { LobbyingSpendingTable } from '../../components/lobbying/LobbyingSpendingTable';
import { ApiError } from '../../data/api';
import { useLobbyingPrincipal } from '../../hooks/useLobbying';
import { useResponsive } from '../../hooks/useResponsive';
import { centralDateLabel } from '../../lib/moneyLanding';
import {
  boardFilesCopiedLine,
  lobbyingPrincipalCopy,
  lobbyingRecordNumberFromSlug,
  lobbyingRecordSlug,
  PRINCIPAL_SOURCE_URL,
  PRINCIPAL_SPENDING_UNAVAILABLE,
  principalSpellingLines,
} from '../../lib/lobbyingRecordCopy';
import { lobbyingNoSpendingRows } from '../../lib/lobbyingDirectoryCopy';
import { lobbyingPageMetadata } from '../../lib/lobbyingMetadata';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import type { LobbyingPrincipalLobbyist } from '../../lib/lobbyingTypes';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { markNextWebHistoryChangeAsReplace } from '../../navigation/webHistory';
import { theme } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

export function LobbyingPrincipalScreen({
  route,
  navigation,
}: RootScreenProps<'LobbyingPrincipal'>) {
  const slug = route.params?.slug ?? '';
  const entityId = lobbyingRecordNumberFromSlug(slug);
  const query = useLobbyingPrincipal(entityId);
  const principal = query.data;
  const missing =
    !entityId || (query.isError && query.error instanceof ApiError && query.error.status === 404);
  const canonicalSlug =
    principal?.state === 'reported' && principal.name
      ? lobbyingRecordSlug(principal.name, principal.entity_id)
      : null;

  useEffect(() => {
    if (!isWeb || !canonicalSlug || canonicalSlug === slug) return;
    markNextWebHistoryChangeAsReplace();
    navigation.setParams({ slug: canonicalSlug });
  }, [canonicalSlug, navigation, slug]);

  const pagePath = entityId ? routePath.lobbyingPrincipal(slug) : null;
  const pageTitle =
    pagePath && principal?.name
      ? lobbyingPageMetadata(pagePath, principal.name, { kind: 'principal' }).title
      : null;
  useDocumentTitle(pagePath, pageTitle);

  const shell = (children: React.ReactNode) => (
    <LobbyingPageFrame
      onBack={() => navigation.navigate('LobbyingLanding')}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
    >
      {children}
    </LobbyingPageFrame>
  );

  if (missing) return shell(<LobbyingRecordState state="not-found" identifier={entityId} />);
  if (query.isPending || !principal) {
    return shell(
      <LobbyingRecordState
        state={query.isError ? 'unavailable' : 'loading'}
        identifier={entityId}
        onRetry={() => void query.refetch()}
      />,
    );
  }
  if (principal.state === 'no_spending_rows') {
    return shell(<LobbyingRecordState state="not-found" identifier={entityId} />);
  }
  if (principal.state === 'unavailable' || !principal.name) {
    return shell(
      <LobbyingRecordState
        state="unavailable"
        identifier={entityId}
        onRetry={() => void query.refetch()}
      />,
    );
  }

  const finalSlug = canonicalSlug ?? slug;
  const shareContent: ShareContent = {
    subject: 'principal',
    title: lobbyingPageMetadata(routePath.lobbyingPrincipal(finalSlug), principal.name, {
      kind: 'principal',
    }).title,
    description: `${principal.name}'s reported lobbying spending and current registered lobbyists, from Minnesota's own records.`,
    url: publicPageUrl(routePath.lobbyingPrincipal(finalSlug)),
  };
  const copiedLine = boardFilesCopiedLine(principal.copied_at, centralDateLabel);
  const spellingLines = principalSpellingLines(principal.lobbyists.rows);

  return (
    <LobbyingPageFrame
      eyebrow={`PRINCIPAL · ENTITY ${principal.entity_id}`}
      title={principal.name}
      details={
        <HeaderDetails>
          <Text style={styles.gloss}>{lobbyingPrincipalCopy.gloss}</Text>
          {spellingLines.map((line) => (
            <Text key={line} style={styles.detailLine}>
              {line}
            </Text>
          ))}
          {copiedLine ? <Text style={styles.copyDate}>{copiedLine}</Text> : null}
        </HeaderDetails>
      }
      shareContent={shareContent}
      source={{ label: lobbyingPrincipalCopy.sourceLabel, url: PRINCIPAL_SOURCE_URL }}
      onBack={() => navigation.navigate('LobbyingLanding')}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
    >
      <LobbyingCard label="Spending by year" title={lobbyingPrincipalCopy.spendingHeading}>
        <CardParagraph>{lobbyingPrincipalCopy.spendingIntroduction}</CardParagraph>
        {principal.spending.state === 'unavailable' ? (
          <Text accessibilityRole="alert" style={styles.unavailable}>
            {PRINCIPAL_SPENDING_UNAVAILABLE}
          </Text>
        ) : principal.spending.rows.length === 0 ||
          principal.spending.state === 'no_spending_rows' ? (
          <Text style={styles.empty}>{lobbyingNoSpendingRows(principal.source_latest_year)}</Text>
        ) : (
          <LobbyingSpendingTable rows={principal.spending.rows} />
        )}
      </LobbyingCard>
      <PrincipalLobbyistsCard
        state={principal.lobbyists.state}
        total={principal.lobbyists.total}
        rows={principal.lobbyists.rows}
        onOpenLobbyist={(row: LobbyingPrincipalLobbyist) =>
          navigation.push('LobbyingLobbyist', {
            slug: lobbyingRecordSlug(row.name, row.registration_number),
          })
        }
      />
    </LobbyingPageFrame>
  );
}

export default LobbyingPrincipalScreen;

function HeaderDetails({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

function CardParagraph({ children }: { children: React.ReactNode }) {
  const { isMobile, isTablet } = useResponsive();
  return (
    <Text style={[styles.cardParagraph, { fontSize: isMobile || isTablet ? 16 : 17 }]}>
      {children}
    </Text>
  );
}

const styles: Record<string, any> = {
  gloss: {
    marginTop: 12,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 25,
  },
  detailLine: {
    marginTop: 6,
    color: '#6b716b',
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  copyDate: {
    marginTop: 10,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  cardParagraph: {
    marginTop: 12,
    maxWidth: 820,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    lineHeight: 26,
  },
  unavailable: {
    marginTop: 16,
    maxWidth: 820,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  empty: {
    marginTop: 16,
    maxWidth: 820,
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
};
