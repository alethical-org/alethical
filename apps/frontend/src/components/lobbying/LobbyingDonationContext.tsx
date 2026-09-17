import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import { LinkArrowLabel, linkArrowRow } from '../LinkArrow';
import { useLobbyingLobbyist } from '../../hooks/useLobbying';
import type { MoneyDetailsGroup } from '../../lib/campaignMoneyDetails';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import {
  donationRegistrationNumbers,
  hasLobbyistLookupNumber,
  lobbyingPanelCopy as copy,
} from '../../lib/lobbyingPanelCopy';
import { linkProps, routePath } from '../../navigation/links';
import type { RootStackParamList } from '../../navigation/types';
import { useDetailsStyles } from '../campaignMoney/detailsStyles';

/** Mounted only inside the open payment panel; dates and amounts stay underneath. */
export function LobbyingDonationContext({
  group,
  year,
}: {
  group: MoneyDetailsGroup;
  year: number;
}) {
  if (group.tab !== 'lobbyists' && group.tab !== 'committees') return null;
  const numbers = donationRegistrationNumbers(group);
  const linkable =
    group.linkableRegistrationNumbers ??
    (group.linkableRegistrationNumber ? [group.linkableRegistrationNumber] : []);
  return (
    <View>
      {numbers.map((number) =>
        group.tab === 'lobbyists' && hasLobbyistLookupNumber(number) ? (
          <LobbyistContext key={number} number={number} filedName={group.printedName} />
        ) : (
          <CommitteeContext
            key={number}
            number={number}
            name={group.name}
            year={year}
            linkable={group.tab === 'committees' && linkable.includes(number)}
          />
        ),
      )}
    </View>
  );
}

function LobbyistContext({ number, filedName }: { number: string; filedName: string | null }) {
  const s = useDetailsStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const read = useLobbyingLobbyist(number);
  const data = read.data;
  const failed = read.isError || data?.state === 'unavailable';
  const registeredName = !failed && data?.state === 'reported' ? data.name : null;
  const line =
    !failed && data?.state === 'not_registered_today'
      ? copy.notRegistered(number)
      : registeredName && registeredName !== filedName
        ? copy.registeredAs(number, registeredName)
        : copy.registration(number);
  const slug = registeredName ? committeeSlug(registeredName, number) : null;
  return (
    <View style={styles.context}>
      <Text style={[s.small, styles.registration]}>{line}</Text>
      {registeredName && slug && !failed ? (
        <Pressable
          {...linkProps(routePath.lobbyingLobbyist(slug), () =>
            navigation.navigate('LobbyingLobbyist', { slug }),
          )}
          style={(state) => [styles.link, Boolean('focused' in state && state.focused) && s.focus]}
        >
          <LinkArrowLabel
            label={copy.representsLink(registeredName)}
            style={[s.small, styles.linkText]}
          />
        </Pressable>
      ) : failed ? (
        <View style={styles.recovery}>
          <Text accessibilityRole="alert" style={s.small}>
            {copy.unavailable}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void read.refetch()}
            style={(state) => [s.control, Boolean('focused' in state && state.focused) && s.focus]}
          >
            <Text style={s.controlText}>{copy.retry}</Text>
          </Pressable>
        </View>
      ) : read.isPending ? (
        <Text role="status" style={s.small}>
          {copy.loading}
        </Text>
      ) : null}
    </View>
  );
}

function CommitteeContext({
  number,
  name,
  year,
  linkable,
}: {
  number: string;
  name: string;
  year: number;
  linkable: boolean;
}) {
  const s = useDetailsStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const slug = committeeSlug(name, number);
  return (
    <View style={styles.context}>
      <Text style={[s.small, styles.registration]}>{copy.registration(number)}</Text>
      {linkable ? (
        <Pressable
          {...linkProps(routePath.moneyCommittee(slug, { year: String(year) }), () =>
            navigation.navigate('CommitteeMoney', { slug, year: String(year) }),
          )}
          style={(state) => [styles.link, Boolean('focused' in state && state.focused) && s.focus]}
        >
          <LinkArrowLabel label={copy.committeeLink} style={[s.small, styles.linkText]} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 14,
    minHeight: 44,
  },
  registration: { fontWeight: '700', color: c.secondary, fontVariant: ['tabular-nums'] },
  link: {
    ...linkArrowRow,
    minHeight: 44,
    minWidth: 0,
    flexShrink: 1,
  },
  linkText: { color: c.link, fontWeight: '700', flexShrink: 1 },
  recovery: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
});
