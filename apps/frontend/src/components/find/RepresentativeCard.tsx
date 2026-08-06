import { createElement, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Legislator } from '../../data/types';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

function roleTitle(chamber: Legislator['chamber']) {
  return chamber === 'Senate' ? 'State Senator' : 'State Representative';
}

function ExternalLink({
  label,
  url,
  newTab = true,
}: {
  label: string;
  url: string;
  newTab?: boolean;
}) {
  return (
    <Pressable
      {...(newTab
        ? externalLinkProps(url, () => void Linking.openURL(url))
        : { accessibilityRole: 'link' as const, onPress: () => void Linking.openURL(url) })}
      accessibilityLabel={newTab ? `${label}, opens in a new tab` : label}
      style={styles.linkTarget}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export function RepresentativeCard({
  legislator,
  onProfile,
}: {
  legislator: Legislator;
  onProfile: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const assignments = legislator.committeeAssignments ?? [];
  const issues = legislator.issueAreas ?? [];
  const officialUrl = legislator.profileUrl;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.portrait}>
          {legislator.photoUrl && !photoFailed ? (
            isWeb ? (
              createElement('img', {
                alt: '',
                'aria-hidden': true,
                src: legislator.photoUrl,
                onError: () => setPhotoFailed(true),
                style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' },
              })
            ) : (
              <Image
                accessibilityElementsHidden
                source={{ uri: legislator.photoUrl }}
                onError={() => setPhotoFailed(true)}
                style={styles.portraitImage}
              />
            )
          ) : (
            <Text style={styles.initials}>{initials(legislator.shortName)}</Text>
          )}
        </View>
        <View style={styles.heading}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{legislator.shortName}</Text>
            {legislator.party === 'DFL' || legislator.party === 'R' ? (
              <View style={styles.partyChip}>
                <Text style={styles.party}>{legislator.party}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.office}>{roleTitle(legislator.chamber)}</Text>
          <Text style={styles.district}>District {legislator.district}</Text>
        </View>
      </View>

      {legislator.representedCity ? (
        <View style={styles.factRow}>
          <Text style={styles.label}>RESIDENCE</Text>
          <Text style={styles.value}>{legislator.representedCity}</Text>
        </View>
      ) : null}

      {assignments.length ? (
        <View style={styles.section}>
          <Text style={styles.label}>COMMITTEES & LEADERSHIP</Text>
          {assignments.map((assignment) => (
            <Text key={`${assignment.name}-${assignment.role ?? ''}`} style={styles.value}>
              {assignment.name}
              {assignment.role ? ` · ${assignment.role}` : ''}
            </Text>
          ))}
        </View>
      ) : null}

      {legislator.totalAuthoredBills != null ? (
        <View style={styles.section}>
          <Text style={styles.label}>BILLS AUTHORED</Text>
          <Text style={styles.value}>
            {legislator.totalAuthoredBills} total
            {legislator.chiefAuthoredBills != null
              ? ` · ${legislator.chiefAuthoredBills} as chief author`
              : ''}
          </Text>
        </View>
      ) : null}

      {legislator.legislativeService ? (
        <View style={styles.section}>
          <Text style={styles.label}>ELECTION & TERM</Text>
          {legislator.legislativeService.lines.map((line) => (
            <Text key={`${line.chamber}-${line.elected}`} style={styles.value}>
              {line.label}: {line.elected}
            </Text>
          ))}
          {legislator.legislativeService.term ? (
            <Text style={styles.value}>
              Current chamber term: {legislator.legislativeService.term}
            </Text>
          ) : null}
        </View>
      ) : null}

      {issues.length ? (
        <View style={styles.section}>
          <Text style={styles.label}>ISSUES ON BILLS AUTHORED</Text>
          <View style={styles.chips}>
            {issues.map((issue) => (
              <View key={issue} style={styles.issueChip}>
                <Text style={styles.issueText}>{issue}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {legislator.email || legislator.phone || legislator.officeAddress ? (
        <View style={styles.contact}>
          {legislator.email ? (
            <ExternalLink
              label={legislator.email}
              url={`mailto:${legislator.email}`}
              newTab={false}
            />
          ) : null}
          {legislator.phone ? <Text style={styles.value}>{legislator.phone}</Text> : null}
          {legislator.officeAddress ? (
            <Text style={styles.value}>{legislator.officeAddress}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.links}>
        {officialUrl ? <ExternalLink label="Official Legislature page" url={officialUrl} /> : null}
        <Pressable
          {...linkProps(routePath.legislator(legislator.slug ?? legislator.id), onProfile)}
        >
          <Text style={styles.profileLink}>View profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function VacantSeatCard() {
  return (
    <View style={[styles.card, styles.vacant]} accessible accessibilityRole="summary">
      <Text style={styles.name}>Seat vacant</Text>
      <Text style={styles.value}>No member currently holds this seat.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    padding: 24,
    gap: 16,
    ...(t.shadows.card as object),
  },
  vacant: { minHeight: 180, justifyContent: 'center' },
  header: { flexDirection: 'row', gap: 14 },
  portrait: {
    width: 68,
    height: 80,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitImage: { width: '100%', height: '100%' },
  initials: { fontFamily: t.typography.title, fontSize: 22, color: t.colors.brand.deep },
  heading: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  name: { fontFamily: t.typography.title, fontSize: 22, fontWeight: '800', color: t.colors.ink },
  partyChip: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  party: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  office: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.brand.deep,
  },
  district: { fontFamily: t.typography.body, fontSize: 14, color: t.colors.text.muted },
  factRow: { gap: 4 },
  section: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08, paddingTop: 14, gap: 6 },
  label: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: t.colors.text.faint,
  },
  value: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  issueChip: {
    backgroundColor: t.colors.tint.t100,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  issueText: { fontFamily: t.typography.ui, fontSize: 12, color: t.colors.brand.deep },
  contact: { gap: 4 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'center' },
  linkTarget: { minHeight: 44, justifyContent: 'center' },
  link: {
    fontFamily: t.typography.body,
    fontSize: 14,
    color: t.colors.brand.deep,
    textDecorationLine: 'underline',
  },
  profileLink: {
    minHeight: 44,
    textAlignVertical: 'center',
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.brand.deep,
    textDecorationLine: 'underline',
  },
});
