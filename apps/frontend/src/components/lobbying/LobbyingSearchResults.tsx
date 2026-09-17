import { useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { LinkArrowLabel, linkArrowRow } from '../LinkArrow';
import type { useLobbyingNameSearch } from '../../hooks/useLobbyingNameSearch';
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { lobbyingNoSpendingRows } from '../../lib/lobbyingDirectoryCopy';
import {
  LOBBYING_SEARCH_COPY as copy,
  lobbyingResultMeta,
  lobbyingSearchCount,
  lobbyingSearchTitle,
  lobbyingWiderSearchLabel,
} from '../../lib/lobbyingSearch';
import type { LobbyingLobbyistListRow, LobbyingPrincipalListRow } from '../../lib/lobbyingTypes';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { theme as t } from '../../theme/tokens';

type Search = ReturnType<typeof useLobbyingNameSearch>;
type Navigation = RootScreenProps<'LobbyingLanding'>['navigation'];

export function LobbyingSearchResults({
  query,
  search,
  navigation,
  isMobile,
  isTablet,
}: {
  query: string;
  search: Search;
  navigation: Navigation;
  isMobile: boolean;
  isTablet: boolean;
}) {
  const fontSize = isMobile || isTablet ? 16 : 17;
  const body = { fontSize, lineHeight: fontSize * 1.5 };
  const { lobbyists, principals } = search;
  const waiting = lobbyists.isPending && principals.isPending;
  const failed = (part: Search['lobbyists'] | Search['principals']) =>
    !part.isPending && (part.isError || part.data?.state === 'unavailable');
  const wholeFailure =
    failed(lobbyists) &&
    failed(principals) &&
    (!lobbyists.data || lobbyists.data.state === 'unavailable') &&
    (!principals.data || principals.data.state === 'unavailable');
  const empty =
    lobbyists.data?.total === 0 &&
    principals.data?.total === 0 &&
    !failed(lobbyists) &&
    !failed(principals);
  // Keep the live announcement short. The linked result lists are read on request.
  const announcement = waiting
    ? copy.loading
    : wholeFailure
      ? copy.unavailable
      : [
          lobbyingSearchTitle(query),
          ...(['lobbyists', 'principals'] as const).map((kind) => {
            const part = search[kind];
            return part.isPending
              ? `${copy[kind].title}: ${copy.loading}`
              : failed(part)
                ? copy[kind].unavailable
                : `${copy[kind].title}: ${lobbyingSearchCount(part.data?.total ?? null) ?? ''}`;
          }),
        ].join('. ');

  return (
    <View style={styles.results}>
      <View role="status" aria-live="polite" aria-atomic style={styles.hidden}>
        <Text>{announcement}</Text>
      </View>
      {waiting ? (
        <Text style={[styles.heading, { fontSize: 24 }]}>{copy.loading}</Text>
      ) : wholeFailure ? (
        <View>
          <Text style={[styles.body, body]}>{copy.unavailable}</Text>
          <Retry
            onPress={() => {
              void lobbyists.refetch();
              void principals.refetch();
            }}
          />
        </View>
      ) : (
        <>
          <Text
            accessibilityRole="header"
            aria-level={2}
            style={[styles.heading, { fontSize: isMobile ? 25 : isTablet ? 28 : 32 }]}
          >
            {lobbyingSearchTitle(query)}
          </Text>
          {(['lobbyists', 'principals'] as const).map((kind) => {
            const part = search[kind];
            const rows: (LobbyingLobbyistListRow | LobbyingPrincipalListRow)[] =
              part.data?.state === 'unavailable'
                ? []
                : part.data && 'lobbyists' in part.data
                  ? part.data.lobbyists
                  : part.data && 'principals' in part.data
                    ? part.data.principals
                    : [];
            const isFailed = failed(part);
            const count =
              !isFailed && !part.isPending ? lobbyingSearchCount(part.data?.total ?? null) : null;
            const moreHref =
              kind === 'lobbyists'
                ? routePath.lobbyingLobbyists({ q: query })
                : routePath.lobbyingPrincipals({ q: query });
            const openMore = () =>
              kind === 'lobbyists'
                ? navigation.navigate('LobbyingLobbyists', { q: query })
                : navigation.navigate('LobbyingPrincipals', { q: query });
            return (
              <View key={kind} style={styles.group}>
                <View style={styles.headingRow}>
                  <Text
                    accessibilityRole="header"
                    aria-level={3}
                    style={[styles.heading, { fontSize: isMobile ? 20 : isTablet ? 22 : 24 }]}
                  >
                    {copy[kind].title}
                  </Text>
                  {count !== null ? <Text style={styles.count}>{count}</Text> : null}
                </View>
                <Text style={styles.note}>{copy[kind].note}</Text>
                {part.isPending ? <Text style={[styles.message, body]}>{copy.loading}</Text> : null}
                {isFailed ? (
                  <View style={styles.message}>
                    <Text style={[styles.body, body]}>{copy[kind].unavailable}</Text>
                    <Retry onPress={() => void part.refetch()} />
                  </View>
                ) : null}
                {!part.isPending && !isFailed && part.data?.total === 0 ? (
                  <Text style={[styles.message, styles.strong, body]}>{copy[kind].empty}</Text>
                ) : null}
                {rows.length ? (
                  <View role="list" style={styles.rows}>
                    {rows.map((row) => {
                      const lobbyist = 'registration_number' in row;
                      const id = lobbyist ? row.registration_number : row.entity_id;
                      const slug = committeeSlug(row.name, String(id));
                      const linkable = lobbyist || row.linkable;
                      const href = lobbyist
                        ? routePath.lobbyingLobbyist(slug)
                        : routePath.lobbyingPrincipal(slug);
                      const open = () =>
                        lobbyist
                          ? navigation.navigate('LobbyingLobbyist', { slug })
                          : navigation.navigate('LobbyingPrincipal', { slug });
                      const text = (hovered = false) => (
                        <View style={styles.rowWords}>
                          {linkable ? (
                            <LinkArrowLabel
                              label={row.name}
                              style={[styles.rowName, body, hovered && styles.underline]}
                            />
                          ) : (
                            <Text style={[styles.rowName, body]}>{row.name}</Text>
                          )}
                          <Text style={styles.meta}>{lobbyingResultMeta(row)}</Text>
                          {!lobbyist && !row.linkable ? (
                            <Text style={styles.meta}>
                              {lobbyingNoSpendingRows(
                                principals.data?.latest_reported_year ?? null,
                              ).replace("Board's", 'Board’s')}
                            </Text>
                          ) : null}
                          {!lobbyist
                            ? row.registered_names?.map((name) => (
                                <Text key={name} style={styles.meta}>
                                  Registered as {name} in the lobbyist list
                                </Text>
                              ))
                            : null}
                        </View>
                      );
                      return (
                        <View role="listitem" key={id}>
                          {linkable ? (
                            <SearchLink href={href} onPress={open} style={styles.row}>
                              {(hovered) => text(hovered)}
                            </SearchLink>
                          ) : (
                            <View style={styles.row}>{text()}</View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                {!isFailed && part.data?.has_more ? (
                  <SearchLink href={moreHref} onPress={openMore} style={styles.link}>
                    {(hovered) => (
                      <LinkArrowLabel
                        label={copy[kind].more}
                        style={[styles.linkText, body, hovered && styles.underline]}
                      />
                    )}
                  </SearchLink>
                ) : null}
              </View>
            );
          })}
          {empty ? <Text style={[styles.message, body]}>{copy.noMatchHint}</Text> : null}
        </>
      )}
      <SearchLink
        href={routePath.moneySearch({ q: query })}
        onPress={() => navigation.navigate('MoneySearch', { q: query })}
        style={[styles.link, styles.wider]}
      >
        {(hovered) => (
          <LinkArrowLabel
            label={lobbyingWiderSearchLabel(query)}
            style={[styles.linkText, body, hovered && styles.underline]}
          />
        )}
      </SearchLink>
    </View>
  );
}

function SearchLink({
  href,
  onPress,
  style,
  children,
}: {
  href: string;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  children: (hovered: boolean) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...linkProps(href, onPress)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={style}
    >
      {children(hovered)}
    </Pressable>
  );
}

export function Retry({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.retry}>
      <Text style={styles.linkText}>Try again</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  results: { marginTop: 34, maxWidth: 900 },
  heading: { fontFamily: t.typography.title, color: '#11150f', fontWeight: '800' },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' },
  group: { marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderColor: 'rgba(17,21,15,0.14)' },
  count: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    fontWeight: '800',
    color: '#4f5651',
  },
  body: { fontFamily: t.typography.body, color: '#11150f' },
  note: {
    marginTop: 8,
    maxWidth: 720,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    color: '#656c66',
  },
  rows: { marginTop: 12, borderTopWidth: 1, borderColor: 'rgba(17,21,15,0.1)' },
  row: {
    minHeight: 60,
    ...linkArrowRow,
    paddingVertical: 11,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
  },
  rowWords: { flex: 1, minWidth: 0, gap: 4 },
  rowName: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontWeight: '700',
    ...({ overflowWrap: 'anywhere' } as TextStyle),
  },
  meta: {
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    lineHeight: 21.75,
    ...({ overflowWrap: 'anywhere' } as TextStyle),
  },
  message: { marginTop: 14, fontFamily: t.typography.body, color: '#11150f' },
  strong: { fontWeight: '700' },
  link: {
    ...linkArrowRow,
    marginTop: 6,
    minHeight: 44,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  linkText: {
    fontFamily: t.typography.body,
    color: '#0f7a45',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
    ...({ overflowWrap: 'anywhere' } as TextStyle),
  },
  underline: { textDecorationLine: 'underline' },
  wider: { marginTop: 22 },
  retry: {
    marginTop: 12,
    minHeight: 44,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
