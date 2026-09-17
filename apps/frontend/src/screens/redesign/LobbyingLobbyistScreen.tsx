import React, { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import {
  LobbyingPageFrame,
  LobbyingRecordState,
} from '../../components/lobbying/LobbyingPageFrame';
import {
  LobbyistDonationsCard,
  LobbyistPrincipalsCard,
} from '../../components/lobbying/LobbyingRecordCards';
import { ApiError } from '../../data/api';
import { useLobbyingLobbyist } from '../../hooks/useLobbying';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { centralDateLabel } from '../../lib/moneyLanding';
import { lobbyingPageMetadata } from '../../lib/lobbyingMetadata';
import {
  boardFilesCopiedLine,
  campaignContributionCopiedLine,
  LOBBYIST_SOURCE_URL,
  lobbyingLobbyistCopy,
  lobbyingRecordNumberFromSlug,
  lobbyingRecordSlug,
} from '../../lib/lobbyingRecordCopy';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import type { LobbyingAssociation } from '../../lib/lobbyingTypes';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { markNextWebHistoryChangeAsReplace } from '../../navigation/webHistory';
import { theme } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

export function LobbyingLobbyistScreen({ route, navigation }: RootScreenProps<'LobbyingLobbyist'>) {
  const slug = route.params?.slug ?? '';
  const registrationNumber = lobbyingRecordNumberFromSlug(slug);
  const query = useLobbyingLobbyist(registrationNumber);
  const lobbyist = query.data;
  const missing =
    !registrationNumber ||
    (query.isError && query.error instanceof ApiError && query.error.status === 404);
  const name = lobbyist
    ? (lobbyist.name ?? lobbyist.formatted_name ?? `Registration ${lobbyist.registration_number}`)
    : null;
  const canonicalSlug = name ? lobbyingRecordSlug(name, lobbyist!.registration_number) : null;

  useEffect(() => {
    if (!isWeb || !canonicalSlug || canonicalSlug === slug) return;
    markNextWebHistoryChangeAsReplace();
    navigation.setParams({ slug: canonicalSlug });
  }, [canonicalSlug, navigation, slug]);

  const pagePath = registrationNumber ? routePath.lobbyingLobbyist(slug) : null;
  const pageTitle =
    pagePath && name ? lobbyingPageMetadata(pagePath, name, { kind: 'lobbyist' }).title : null;
  useDocumentTitle(pagePath, pageTitle);

  const shell = (children: React.ReactNode) => (
    <LobbyingPageFrame
      onBack={() => navigation.navigate('LobbyingLanding')}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
    >
      {children}
    </LobbyingPageFrame>
  );

  if (missing) {
    return shell(<LobbyingRecordState state="not-found" identifier={registrationNumber} />);
  }
  if (query.isPending || !lobbyist) {
    return shell(
      <LobbyingRecordState
        state={query.isError ? 'unavailable' : 'loading'}
        identifier={registrationNumber}
        onRetry={() => void query.refetch()}
      />,
    );
  }
  if (lobbyist.state === 'unavailable') {
    return shell(
      <LobbyingRecordState
        state="unavailable"
        identifier={registrationNumber}
        onRetry={() => void query.refetch()}
      />,
    );
  }

  const displayName =
    lobbyist.name ?? lobbyist.formatted_name ?? `Registration ${lobbyist.registration_number}`;
  const finalSlug = canonicalSlug ?? slug;
  const shareContent: ShareContent = {
    subject: 'lobbyist',
    title: lobbyingPageMetadata(routePath.lobbyingLobbyist(finalSlug), displayName, {
      kind: 'lobbyist',
    }).socialTitle,
    description:
      lobbyist.state === 'not_registered_today'
        ? `Campaign donations filed under registration ${lobbyist.registration_number} and its current registration status`
        : `Current clients and campaign donations filed under registration ${lobbyist.registration_number}`,
    url: publicPageUrl(routePath.lobbyingLobbyist(finalSlug)),
  };
  const copiedLine = boardFilesCopiedLine(lobbyist.copied_at, centralDateLabel);
  const contributionDate = campaignContributionCopiedLine(
    lobbyist.contributions.copied_at,
    centralDateLabel,
  );

  return (
    <LobbyingPageFrame
      eyebrow={`LOBBYIST · REGISTRATION ${lobbyist.registration_number}`}
      title={displayName}
      details={<View>{copiedLine ? <Text style={styles.copyDate}>{copiedLine}</Text> : null}</View>}
      shareContent={shareContent}
      source={{ label: lobbyingLobbyistCopy.sourceLabel, url: LOBBYIST_SOURCE_URL }}
      onBack={() => navigation.navigate('LobbyingLanding')}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
    >
      <LobbyistPrincipalsCard
        state={lobbyist.principals.state}
        registrationNumber={lobbyist.registration_number}
        total={lobbyist.principals.total}
        rows={lobbyist.principals.rows}
        latestYear={lobbyist.latest_reported_year}
        onOpenPrincipal={(row: LobbyingAssociation) =>
          navigation.push('LobbyingPrincipal', {
            slug: lobbyingRecordSlug(row.spending_name ?? row.name, row.entity_id),
          })
        }
      />
      <LobbyistDonationsCard
        contributions={lobbyist.contributions}
        registeredName={lobbyist.name ?? displayName}
        copiedDate={contributionDate}
        onOpenCommittee={(committeeRegistration, committeeName) =>
          navigation.push('CommitteeMoney', {
            slug: committeeSlug(committeeName, committeeRegistration),
          })
        }
      />
    </LobbyingPageFrame>
  );
}

export default LobbyingLobbyistScreen;

const styles: Record<string, any> = {
  copyDate: {
    marginTop: 12,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
};
