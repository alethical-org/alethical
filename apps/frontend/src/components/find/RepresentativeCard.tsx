import { createElement } from 'react';
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

function partyLabel(party: Legislator['party']) {
  if (party === 'DFL') return 'Democratic-Farmer-Labor';
  if (party === 'R') return 'Republican';
  return 'Independent';
}

function serviceSummary(service: Legislator['legislativeService']) {
  if (!service) return null;
  const sentences = service.lines.map((line) => `${line.label}: ${line.elected}.`);
  if (service.term) sentences.push(`Current chamber term: ${service.term}.`);
  return sentences.join(' ');
}

function ExternalLink({
  label,
  url,
  newTab = true,
  showExternalMark = false,
}: {
  label: string;
  url: string;
  newTab?: boolean;
  showExternalMark?: boolean;
}) {
  return (
    <Pressable
      {...(newTab
        ? externalLinkProps(url, () => void Linking.openURL(url))
        : { accessibilityRole: 'link' as const, onPress: () => void Linking.openURL(url) })}
      accessibilityLabel={newTab ? `${label}, opens in a new tab` : label}
      style={styles.linkTarget}
    >
      <Text style={styles.link}>
        {label}
        {showExternalMark ? <Text aria-hidden> ↗</Text> : null}
        {newTab ? (
          <Text
            style={[styles.visuallyHidden, isWeb ? ({ clipPath: 'inset(50%)' } as object) : null]}
          >
            {' (opens in a new tab)'}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

export function RepresentativeCard({
  legislator,
  onProfile,
  mobile = false,
  legislatureLabel,
}: {
  legislator: Legislator;
  onProfile: () => void;
  mobile?: boolean;
  /** The lookup screen owns this current-session value. Omit it rather than guessing. */
  legislatureLabel?: string;
}) {
  const assignments = legislator.committeeAssignments ?? [];
  const issues = (legislator.issueAreas ?? []).slice(0, 26);
  const shownIssues = issues.slice(0, 6);
  const remainingIssueCount = issues.length - shownIssues.length;
  const officialUrl = legislator.profileUrl;
  const service = serviceSummary(legislator.legislativeService);
  const chamberLabel = legislator.chamber.toUpperCase();
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View accessible={false} {...({ 'aria-hidden': true } as object)} style={styles.portrait}>
          <Text style={styles.initials}>{initials(legislator.shortName)}</Text>
          {legislator.photoUrl ? (
            isWeb ? (
              createElement('img', {
                alt: '',
                'aria-hidden': true,
                src: legislator.photoUrl,
                style: {
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top',
                },
              })
            ) : (
              <Image
                accessibilityElementsHidden
                source={{ uri: legislator.photoUrl }}
                style={[styles.portraitImage, StyleSheet.absoluteFill]}
              />
            )
          ) : null}
        </View>
        <View style={styles.heading}>
          <Text style={styles.name}>{legislator.shortName}</Text>
          <Text style={styles.districtEyebrow}>
            {roleTitle(legislator.chamber).toUpperCase()} · {chamberLabel} DISTRICT{' '}
            {legislator.district}
          </Text>
        </View>
      </View>

      <View style={styles.factsRow}>
        <View style={styles.fact}>
          <Text style={styles.label}>PARTY</Text>
          <Text style={styles.factValue}>{partyLabel(legislator.party)}</Text>
        </View>
        {legislator.representedCity ? (
          <View style={styles.fact}>
            <Text style={styles.label}>RESIDENCE</Text>
            <Text style={styles.factValue}>{legislator.representedCity}</Text>
          </View>
        ) : null}
      </View>

      {service ? <Text style={styles.service}>{service}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.label}>COMMITTEES</Text>
        {assignments.length ? (
          assignments.map((assignment) => (
            <Text key={`${assignment.name}-${assignment.role ?? ''}`} style={styles.committee}>
              {assignment.name}
              {assignment.role ? `, ${assignment.role}` : ''}
            </Text>
          ))
        ) : (
          <Text style={styles.emptyCommittee}>None recorded</Text>
        )}
      </View>

      {legislator.totalAuthoredBills != null ? (
        <View style={styles.section}>
          <Text style={styles.authored}>{legislator.totalAuthoredBills} bills authored</Text>
          {legislator.chiefAuthoredBills != null ? (
            <Text style={styles.authoredDetail}>
              Including {legislator.chiefAuthoredBills} as chief author
            </Text>
          ) : null}
          {legislatureLabel ? <Text style={styles.legislature}>{legislatureLabel}</Text> : null}
        </View>
      ) : null}

      {issues.length ? (
        <View style={styles.section}>
          <Text style={styles.label}>ISSUES ON BILLS AUTHORED</Text>
          <View style={styles.chips}>
            {shownIssues.map((issue) => (
              <View key={issue} style={styles.issueChip}>
                <Text style={styles.issueText}>{issue}</Text>
              </View>
            ))}
          </View>
          {remainingIssueCount ? (
            <Text style={styles.moreIssues}>+{remainingIssueCount} more</Text>
          ) : null}
        </View>
      ) : null}

      {legislator.email || legislator.phone || legislator.officeAddress || officialUrl ? (
        <View style={styles.contact}>
          {legislator.email ? (
            <ExternalLink
              label={legislator.email}
              url={`mailto:${legislator.email}`}
              newTab={false}
            />
          ) : null}
          {legislator.phone ? (
            <ExternalLink label={legislator.phone} url={`tel:${legislator.phone}`} newTab={false} />
          ) : null}
          {legislator.officeAddress ? (
            <Text style={styles.contactValue}>{legislator.officeAddress}</Text>
          ) : null}
          {officialUrl ? (
            <ExternalLink
              label={`Official ${legislator.chamber} page`}
              url={officialUrl}
              showExternalMark
            />
          ) : null}
        </View>
      ) : null}

      <Pressable
        {...linkProps(routePath.legislator(legislator.slug ?? legislator.id), onProfile)}
        style={[styles.profileButton, mobile && styles.profileButtonMobile]}
      >
        <Text style={styles.profileLink}>
          {mobile ? 'View full profile' : 'View profile'} <Text aria-hidden>→</Text>
        </Text>
      </Pressable>
    </View>
  );
}

export function VacantSeatCard({ districtLabel }: { districtLabel?: string }) {
  return (
    <View style={styles.vacant} accessible accessibilityRole="summary">
      {districtLabel ? <Text style={styles.vacantDistrict}>{districtLabel}</Text> : <View />}
      <View>
        <Text style={styles.name}>Seat vacant</Text>
        <Text style={styles.vacantText}>No member currently holds this seat.</Text>
      </View>
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
  vacant: {
    flex: 1,
    minWidth: 0,
    minHeight: 240,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 18,
    padding: 26,
    backgroundColor: t.colors.surfaces.s100,
    justifyContent: 'space-between',
  },
  vacantDistrict: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.54,
    color: t.colors.text.secondary,
  },
  vacantText: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  portrait: {
    width: 64,
    height: 74,
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
  heading: { flex: 1, minWidth: 0 },
  name: { fontFamily: t.typography.title, fontSize: 22, fontWeight: '800', color: t.colors.ink },
  districtEyebrow: {
    marginTop: 6,
    fontFamily: t.typography.mono,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.38,
    color: t.colors.brand.deep,
  },
  factsRow: {
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    paddingTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 26,
  },
  fact: { minWidth: 0, gap: 5 },
  factValue: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    fontWeight: '600',
    color: t.colors.ink,
  },
  service: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  section: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08, paddingTop: 14, gap: 6 },
  label: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.05,
    color: t.colors.text.secondary,
  },
  committee: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 21,
    color: t.colors.ink,
  },
  emptyCommittee: { fontFamily: t.typography.body, fontSize: 15, lineHeight: 21, color: '#6f756f' },
  authored: { fontFamily: t.typography.body, fontSize: 16, color: t.colors.ink },
  authoredDetail: { fontFamily: t.typography.body, fontSize: 14.5, color: t.colors.text.secondary },
  legislature: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.88,
    color: '#6f756f',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  issueChip: {
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 5,
    ...(isWeb
      ? ({ display: 'inline-flex', whiteSpace: 'normal', overflowWrap: 'anywhere' } as object)
      : null),
  },
  issueText: {
    flexShrink: 1,
    fontFamily: t.typography.ui,
    fontSize: 12.5,
    fontWeight: '600',
    color: t.colors.text.secondary,
    ...(isWeb ? ({ overflowWrap: 'anywhere' } as object) : null),
  },
  moreIssues: {
    marginTop: 7,
    fontFamily: t.typography.ui,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#6f756f',
  },
  contact: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08, paddingTop: 14, gap: 4 },
  contactValue: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  linkTarget: { minHeight: 44, justifyContent: 'center' },
  link: {
    fontFamily: t.typography.body,
    fontSize: 14,
    color: t.colors.brand.deep,
    textDecorationLine: 'underline',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  profileButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: t.colors.ink,
  },
  profileButtonMobile: { alignSelf: 'stretch', minHeight: 46 },
  profileLink: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.white,
  },
});
