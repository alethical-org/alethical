import { createElement, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Legislator } from '../../data/types';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { LinkArrow } from '../LinkArrow';

const isWeb = Platform.OS === 'web';

function alignedRowStyle(row: number) {
  return isWeb ? ({ gridRow: row } as object) : undefined;
}

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

function phoneHref(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const nationalDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `tel:+1${nationalDigits}`;
}

function ContactLink({
  label,
  url,
  newTab = true,
  trailingArrow = false,
  mobile = false,
  wrap = false,
}: {
  label: string;
  url: string;
  newTab?: boolean;
  trailingArrow?: boolean;
  mobile?: boolean;
  wrap?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...(newTab
        ? externalLinkProps(url, () => void Linking.openURL(url))
        : linkProps(url, () => void Linking.openURL(url)))}
      accessibilityLabel={newTab ? `${label}, opens in a new tab` : label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.linkTarget, wrap && styles.wrappingLinkTarget]}
    >
      {trailingArrow ? (
        <View style={styles.arrowLinkContent}>
          <Text
            style={[
              styles.contactLink,
              mobile && styles.contactLinkMobile,
              hovered && styles.contactLinkHovered,
            ]}
          >
            {label}
          </Text>
          <LinkArrow color={t.colors.brand.deep} />
          {newTab ? (
            <Text
              style={[styles.visuallyHidden, isWeb ? ({ clipPath: 'inset(50%)' } as object) : null]}
            >
              {' (opens in a new tab)'}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          style={[
            styles.contactLink,
            mobile && styles.contactLinkMobile,
            wrap && styles.wrappingLink,
            hovered && styles.contactLinkHovered,
          ]}
        >
          {label}
          {newTab ? (
            <Text
              style={[styles.visuallyHidden, isWeb ? ({ clipPath: 'inset(50%)' } as object) : null]}
            >
              {' (opens in a new tab)'}
            </Text>
          ) : null}
        </Text>
      )}
    </Pressable>
  );
}

export function RepresentativeCard({
  legislator,
  onProfile,
  mobile = false,
  alignSections = false,
  legislatureLabel,
}: {
  legislator: Legislator;
  onProfile: () => void;
  mobile?: boolean;
  alignSections?: boolean;
  /** The lookup screen owns this current-session value. Omit it rather than guessing. */
  legislatureLabel?: string;
}) {
  const [profileHovered, setProfileHovered] = useState(false);
  // The initials used to sit behind the photo, so a file that failed to load
  // revealed them on its own. Now the photo sizes the frame and the initials
  // are its alternative, so a failure has to be caught to fall back (#1334).
  const [photoFailed, setPhotoFailed] = useState(false);
  const showingPortrait = Boolean(legislator.photoUrl) && !photoFailed;
  const assignments = (legislator.committeeAssignments ?? []).slice(0, 3);
  const issues = (legislator.issueAreas ?? []).slice(0, 26);
  const shownIssues = issues.slice(0, 6);
  const remainingIssueCount = issues.length - shownIssues.length;
  const officialUrl = legislator.profileUrl;
  const service = serviceSummary(legislator.legislativeService);
  const chamberLabel = legislator.chamber.toUpperCase();
  const roleLabel = roleTitle(legislator.chamber).toUpperCase();
  const districtLabel = `${chamberLabel} DISTRICT ${legislator.district}`;
  return (
    <View style={[styles.card, alignSections && styles.alignedCard, mobile && styles.cardMobile]}>
      <View
        style={[styles.header, alignSections && alignedRowStyle(1), mobile && styles.headerMobile]}
      >
        <View
          accessible={false}
          {...({ 'aria-hidden': true } as object)}
          // A photo sets its own height so the frame ends exactly where the
          // picture does, leaving no strip of tint showing under it (#1334).
          // The initials fallback still needs the fixed box below.
          style={[styles.portrait, showingPortrait && styles.portraitWithPhoto]}
        >
          {showingPortrait ? (
            isWeb ? (
              createElement('img', {
                alt: '',
                'aria-hidden': true,
                src: legislator.photoUrl,
                width: 64,
                height: 83,
                onError: () => setPhotoFailed(true),
                style: {
                  display: 'block',
                  width: '100%',
                  // Height follows the photo's own proportions: nothing to
                  // crop, nothing left over. See LEGISLATOR_PORTRAIT_HEIGHT in
                  // lib/legislatorSearch.ts (#1334).
                  height: 'auto',
                },
              })
            ) : (
              <Image
                accessibilityElementsHidden
                source={{ uri: legislator.photoUrl }}
                style={styles.portraitImage}
                onError={() => setPhotoFailed(true)}
                // Phone builds cannot read the file's proportions before it
                // arrives, so they assume the common source shape and still
                // fit inside, which never crops (#1334).
                resizeMode="contain"
              />
            )
          ) : (
            <Text style={styles.initials}>{initials(legislator.shortName)}</Text>
          )}
        </View>
        <View style={styles.heading}>
          <Text style={styles.name}>{legislator.shortName}</Text>
          <View
            accessible
            accessibilityLabel={`${roleLabel}, ${districtLabel}`}
            style={[styles.districtEyebrow, mobile && styles.districtEyebrowMobile]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.districtEyebrowText,
                styles.districtEyebrowPart,
                mobile && styles.districtEyebrowTextMobile,
              ]}
            >
              {roleLabel}
            </Text>
            {mobile ? null : (
              <Text
                numberOfLines={1}
                style={[styles.districtEyebrowText, styles.districtEyebrowSeparator]}
              >
                ·
              </Text>
            )}
            <Text
              numberOfLines={1}
              style={[
                styles.districtEyebrowText,
                styles.districtEyebrowPart,
                mobile && styles.districtEyebrowTextMobile,
              ]}
            >
              {districtLabel}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.biography,
          alignSections && alignedRowStyle(2),
          mobile && styles.biographyMobile,
        ]}
      >
        <View style={[styles.factsRow, mobile && styles.factsRowMobile]}>
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

        {service ? (
          <Text style={[styles.service, mobile && styles.serviceMobile]}>{service}</Text>
        ) : null}
      </View>

      <View
        style={[
          styles.section,
          alignSections && alignedRowStyle(3),
          mobile && styles.sectionMobile,
        ]}
      >
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
        <View
          style={[
            styles.section,
            mobile && styles.sectionMobile,
            styles.authoredSection,
            alignSections && alignedRowStyle(4),
          ]}
        >
          {legislatureLabel ? (
            <Text style={[styles.legislature, mobile && styles.legislatureMobile]}>
              {legislatureLabel}
            </Text>
          ) : null}
          <Text style={[styles.authored, mobile && styles.authoredMobile]}>
            <Text style={styles.authoredNumber}>{legislator.totalAuthoredBills}</Text>
            {' bills authored'}
            {legislator.chiefAuthoredBills != null ? (
              <>
                {' · '}
                <Text style={styles.authoredNumber}>{legislator.chiefAuthoredBills}</Text>
                {' as chief author'}
              </>
            ) : null}
          </Text>
        </View>
      ) : null}

      {issues.length ? (
        <View
          style={[
            styles.section,
            alignSections && alignedRowStyle(5),
            mobile && styles.sectionMobile,
          ]}
        >
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
        <View
          style={[
            styles.contact,
            alignSections && alignedRowStyle(6),
            mobile && styles.contactMobile,
          ]}
        >
          {legislator.phone || legislator.email ? (
            <View style={styles.contactChannels}>
              {legislator.phone ? (
                <ContactLink
                  label={legislator.phone}
                  url={phoneHref(legislator.phone)}
                  newTab={false}
                  mobile={mobile}
                />
              ) : null}
              {legislator.phone && legislator.email ? (
                <Text aria-hidden style={styles.contactSeparator}>
                  ·
                </Text>
              ) : null}
              {legislator.email ? (
                <ContactLink
                  label={legislator.email}
                  url={`mailto:${legislator.email}`}
                  newTab={false}
                  mobile={mobile}
                  wrap
                />
              ) : null}
            </View>
          ) : null}
          {legislator.officeAddress ? (
            <Text style={styles.contactValue}>{legislator.officeAddress}</Text>
          ) : null}
          {officialUrl ? (
            <ContactLink
              label={`Official ${legislator.chamber} profile`}
              url={officialUrl}
              trailingArrow
              mobile={mobile}
            />
          ) : null}
        </View>
      ) : null}

      <Pressable
        {...linkProps(routePath.legislator(legislator.slug ?? legislator.id), onProfile)}
        onHoverIn={() => setProfileHovered(true)}
        onHoverOut={() => setProfileHovered(false)}
        style={({ pressed }) => [
          styles.profileButton,
          alignSections && alignedRowStyle(7),
          alignSections && styles.alignedProfileButton,
          mobile && styles.profileButtonMobile,
          (profileHovered || pressed) && styles.profileButtonHovered,
        ]}
      >
        <Text style={styles.profileLink}>View profile</Text>
        <LinkArrow color={t.colors.white} />
      </Pressable>
    </View>
  );
}

export function VacantSeatCard({
  districtLabel,
  mobile = false,
}: {
  districtLabel?: string;
  mobile?: boolean;
}) {
  return (
    <View
      style={[styles.vacant, mobile && styles.vacantMobile]}
      accessible
      accessibilityRole="summary"
    >
      {districtLabel ? <Text style={styles.vacantDistrict}>{districtLabel}</Text> : <View />}
      <View style={mobile && styles.vacantContentMobile}>
        <Text style={[styles.name, mobile && styles.vacantNameMobile]}>Seat vacant</Text>
        <Text style={[styles.vacantText, mobile && styles.vacantTextMobile]}>
          No member currently holds this seat.
        </Text>
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
  cardMobile: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 17,
    gap: 0,
  },
  alignedCard: {
    ...(isWeb
      ? ({ display: 'grid', gridRow: 'span 7', gridTemplateRows: 'subgrid' } as object)
      : null),
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
  vacantMobile: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    minHeight: 0,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 17,
    justifyContent: 'flex-start',
  },
  vacantContentMobile: { marginTop: 8 },
  vacantNameMobile: { fontSize: 19 },
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
  vacantTextMobile: { marginTop: 6, fontSize: 14.5, lineHeight: 21 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  headerMobile: { gap: 13 },
  portrait: {
    width: 64,
    height: 83,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitWithPhoto: { height: 'auto', backgroundColor: 'transparent' },
  portraitImage: { width: '100%', aspectRatio: 160 / 206 },
  initials: { fontFamily: t.typography.title, fontSize: 22, color: t.colors.brand.deep },
  heading: { flex: 1, minWidth: 0 },
  name: { fontFamily: t.typography.title, fontSize: 22, fontWeight: '800', color: t.colors.ink },
  districtEyebrow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'baseline',
  },
  districtEyebrowMobile: { flexDirection: 'column', alignItems: 'flex-start' },
  districtEyebrowText: {
    fontFamily: t.typography.mono,
    fontSize: 12.5,
    lineHeight: 18.75,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: t.colors.brand.deep,
  },
  districtEyebrowTextMobile: { fontSize: 11, lineHeight: 16.5, letterSpacing: 1.32 },
  districtEyebrowSeparator: { marginHorizontal: 10 },
  districtEyebrowPart: {
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  biography: { gap: 16 },
  biographyMobile: { gap: 0 },
  factsRow: {
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    paddingTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 26,
  },
  factsRowMobile: { marginTop: 12, paddingTop: 12, gap: 22 },
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
  serviceMobile: { marginTop: 12, fontSize: 13.5, lineHeight: 20 },
  section: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08, paddingTop: 14, gap: 6 },
  sectionMobile: { marginTop: 12, paddingTop: 12, gap: 7 },
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
  authoredSection: { gap: 0 },
  authored: { fontFamily: t.typography.body, fontSize: 16, lineHeight: 22, color: t.colors.ink },
  authoredMobile: { fontSize: 15, lineHeight: 21 },
  authoredNumber: { fontWeight: '800' },
  legislature: {
    marginBottom: 6,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.88,
    color: '#6f756f',
  },
  legislatureMobile: { fontSize: 10, letterSpacing: 0.8 },
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
  contactMobile: { marginTop: 12, paddingTop: 12, gap: 6 },
  contactChannels: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
  },
  contactSeparator: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    color: '#c2c8c3',
  },
  contactValue: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: '#4f5651',
  },
  linkTarget: { minHeight: 44, maxWidth: '100%', justifyContent: 'center' },
  wrappingLinkTarget: { flexShrink: 1, minWidth: 0 },
  contactLink: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    fontWeight: '600',
    color: t.colors.brand.deep,
    textDecorationLine: 'none',
  },
  contactLinkMobile: { fontSize: 13.5 },
  contactLinkHovered: { textDecorationLine: 'underline' },
  wrappingLink: {
    flexShrink: 1,
    ...(isWeb ? ({ overflowWrap: 'anywhere' } as object) : null),
  },
  arrowLinkContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 11,
    backgroundColor: t.colors.ink,
  },
  profileButtonHovered: { backgroundColor: '#2c322c' },
  alignedProfileButton: {
    ...(isWeb ? ({ justifySelf: 'start' } as object) : null),
  },
  profileButtonMobile: {
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 46,
    marginTop: 13,
  },
  profileLink: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.white,
  },
});
