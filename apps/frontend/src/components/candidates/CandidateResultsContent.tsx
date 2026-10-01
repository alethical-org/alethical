import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';
import {
  CandidateLink,
  CandidateNotice,
  CandidateSourceLine,
  candidateText,
  candidateDate,
  sampleBallotUrl,
} from './CandidateControls';
import type {
  CandidateCoverageGap,
  CandidateElection,
  CandidateEntry,
  CandidateOfficeGroup,
  CandidateRace,
  CandidateSource,
} from './types';

const groups = [
  {
    key: 'state',
    name: 'State offices',
    short: 'State',
    tint: '#e8f6ee',
    edge: '#a8dcbf',
    dot: '#15834a',
    press: '#d6efe1',
  },
  {
    key: 'county',
    name: 'County offices',
    short: 'County',
    tint: '#e4f4f4',
    edge: '#9dd1d1',
    dot: '#147372',
    press: '#d2ebeb',
  },
  {
    key: 'municipal',
    name: 'City or township offices',
    short: 'City or township',
    tint: '#eff3e0',
    edge: '#c6d49b',
    dot: '#5f7a14',
    press: '#e2e9c8',
  },
  {
    key: 'school',
    name: 'School board',
    short: 'School board',
    tint: '#f0ecfb',
    edge: '#c8bcef',
    dot: '#6a50c4',
    press: '#e3dcf7',
  },
  {
    key: 'other',
    name: 'Other local offices',
    short: 'Other local',
    tint: '#f3f0ea',
    edge: '#d4cbbc',
    dot: '#7a6a52',
    press: '#e8e2d7',
  },
] satisfies {
  key: CandidateOfficeGroup;
  name: string;
  short: string;
  tint: string;
  edge: string;
  dot: string;
  press: string;
}[];

function entryName(entry: CandidateEntry) {
  return entry.kind === 'candidate'
    ? entry.candidate.name
    : (entry.label ?? entry.members.map((member) => member.name).join(' and '));
}
function partyLabel(party?: string) {
  return party?.toUpperCase() === 'NONPARTISAN' ? 'Nonpartisan' : party;
}
export function candidateElectionLabel(election: CandidateElection) {
  const prefix = `${candidateDate(election.date)} `;
  if (!election.label.startsWith(prefix)) return election.label;
  const label = election.label.slice(prefix.length);
  if (!new RegExp(`^(?:state )?${election.type}(?: election)?$`, 'i').test(label))
    return election.label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function candidateOfficeLabel(office: string, votingArea?: string) {
  const legislative = office.match(
    /^(State Representative|State Senator),?\s+District\s*(\d+[A-Z]?)$/i,
  );
  if (legislative && votingArea) {
    const chamber = /^State Representative$/i.test(legislative[1]) ? 'House' : 'Senate';
    const district = votingArea.match(new RegExp(`^${chamber} District\\s*(\\d+[A-Z]?)$`, 'i'));
    if (district && district[1].toUpperCase() === legislative[2].toUpperCase())
      return chamber === 'House' ? 'State Representative' : 'State Senator';
  }
  return office
    .replace(/^Governor & Lt Governor$/i, 'Governor and Lieutenant Governor')
    .replace(
      /^(Judge|Associate Justice)\s*-\s*(Supreme Court|Court of Appeals|\d+(?:st|nd|rd|th) District Court)\s+(\d+)$/i,
      '$1, $2, Seat $3',
    );
}
export function areaLabel(area: string) {
  return area.replace(/^Judicial District (\d+(?:st|nd|rd|th))$/i, '$1 Judicial District');
}
function isJudicial(race: CandidateRace) {
  return /\b(?:Supreme Court|Court of Appeals|District Court)\b/i.test(race.office);
}
function judicialRank(race: CandidateRace) {
  return /Supreme Court/i.test(race.office) ? 0 : /Court of Appeals/i.test(race.office) ? 1 : 2;
}
function sameSource(a: CandidateSource, b: CandidateSource) {
  return (
    a.authority === b.authority &&
    a.url === b.url &&
    a.checkedDate === b.checkedDate &&
    Boolean(a.stale) === Boolean(b.stale)
  );
}
export function CandidateRaceCard({
  race,
  election,
  onOpenProfile,
  showSource = true,
  judicial = false,
}: {
  race: CandidateRace;
  election: CandidateElection;
  onOpenProfile(id: string): void;
  showSource?: boolean;
  judicial?: boolean;
}) {
  const entries = [...race.entries].sort((a, b) => entryName(a).localeCompare(entryName(b), 'en'));
  const tickets = entries.filter((entry) => entry.kind === 'ticket');
  return (
    <View style={styles.card}>
      <View style={styles.raceHeader}>
        <View style={styles.raceWords}>
          <Text accessibilityRole="header" aria-level={judicial ? 4 : 3} style={styles.office}>
            {candidateOfficeLabel(race.office, race.votingArea)}
          </Text>
          <Text style={styles.area}>{areaLabel(race.votingArea)}</Text>
        </View>
        <View style={styles.meta}>
          {election.type === 'general' &&
          tickets.length === 0 &&
          Number.isInteger(race.seatCount) &&
          (race.seatCount ?? 0) > 0 ? (
            <Text style={styles.metadata}>
              {race.seatCount} {race.seatCount === 1 ? 'seat' : 'seats'} to fill
            </Text>
          ) : null}
          {tickets.length > 0 ? (
            <Text style={styles.metadata}>
              {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} listed
            </Text>
          ) : null}
        </View>
      </View>
      {tickets.length > 0 ? (
        <Text style={styles.ticketHelp}>
          Each ticket is a pair who run together. You vote for 1 ticket.
        </Text>
      ) : null}
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={candidateText.strong}>No filed candidates listed</Text>
          <Text style={candidateText.body}>
            The available filing records list no candidates for this race
          </Text>
        </View>
      ) : (
        entries.map((entry) => {
          const id = entry.kind === 'candidate' ? entry.candidate.id : entry.id;
          const name = entryName(entry);
          const party = partyLabel(
            entry.kind === 'candidate'
              ? entry.candidate.party
              : (entry.party ?? entry.members[0]?.party),
          );
          return (
            <View key={id} style={styles.entry}>
              <View style={styles.person}>
                <View style={styles.personName}>
                  <Text style={styles.name}>{name}</Text>
                  {party ? <Text style={candidateText.party}>{party}</Text> : null}
                </View>
                <CandidateLink
                  internal
                  url={`/candidates/${encodeURIComponent(id)}`}
                  label="View profile"
                  accessibilityLabel={`View profile, ${name}`}
                  onPress={() => onOpenProfile(id)}
                />
              </View>
            </View>
          );
        })
      )}
      {showSource ? <CandidateSourceLine source={race.source} /> : null}
    </View>
  );
}
export function CandidateCoverage({ gaps }: { gaps: CandidateCoverageGap[] }) {
  return (
    <View style={styles.coverage}>
      <Text accessibilityRole="header" aria-level={2} style={styles.coverageHeading}>
        Coverage for this address
      </Text>
      {gaps.map((gap, index) => (
        <View key={`${gap.kind}-${gap.office}-${index}`} style={styles.gap}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            {Platform.OS === 'web' ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 1 }}
              >
                <path
                  d="M12 3.5 L21.5 20 H2.5 Z M12 10 V14 M12 17 V17.1"
                  stroke="#8f5a12"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={candidateText.strong}>
                {gap.kind === 'coverage-unconfirmed'
                  ? 'Some local offices may be missing'
                  : gap.kind === 'district-unconfirmed'
                    ? `We couldn’t confirm your district for ${gap.office}`
                    : `Candidate records are unavailable for ${gap.office}`}
              </Text>
              {gap.kind !== 'coverage-unconfirmed' ? (
                <CandidateLink label={`Election information from ${gap.authority}`} url={gap.url} />
              ) : null}
            </View>
          </View>
        </View>
      ))}
      <View style={styles.ballot}>
        <Text style={[candidateText.body, { fontSize: 14.5, lineHeight: 22 }]}>
          This is a candidate list, not an official sample ballot
        </Text>
        <CandidateLink label="Minnesota sample ballot information" url={sampleBallotUrl} />
      </View>
    </View>
  );
}

/** Unlike display:none, until-found allows browser search to reveal the closed section. */
function CollapsibleBody({
  id,
  open,
  onReveal,
  children,
}: {
  id: string;
  open: boolean;
  onReveal(): void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    if (open) node.removeAttribute('hidden');
    else node.setAttribute('hidden', 'until-found');
    node.addEventListener('beforematch', onReveal);
    return () => node.removeEventListener('beforematch', onReveal);
  }, [open, onReveal]);
  return Platform.OS === 'web' ? (
    <div
      ref={body}
      id={id}
      className="candidate-group-body"
      {...(!open ? { hidden: 'until-found' as unknown as boolean } : {})}
    >
      {children}
    </div>
  ) : open ? (
    <View nativeID={id}>{children}</View>
  ) : null;
}
function Chevron({ open, size = 20 }: { open: boolean; size?: number }) {
  return (
    <svg
      className="candidate-chevron"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke="#11150f"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function CandidateRaceGroups({
  races,
  election,
  busy,
  onOpenProfile,
  openGroups,
  onGroupOpen,
}: {
  races: CandidateRace[];
  election: CandidateElection;
  busy: boolean;
  onOpenProfile(id: string): void;
  openGroups?: Record<string, boolean>;
  onGroupOpen?(group: string, open: boolean): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const [localOpen, setLocalOpen] = useState<Record<string, boolean>>({});
  const id = useId().replace(/:/g, '');
  const printAnchor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let ancestors: HTMLElement[] = [];
    const restore = () => {
      ancestors.forEach((node) => node.classList.remove('candidate-print-ancestor'));
      ancestors = [];
    };
    const prepare = () => {
      restore();
      const anchor = printAnchor.current;
      // Navigation retains hidden routes: only the visible search may change its
      // scroll ancestors for printing, and normal layout returns after printing.
      if (!anchor?.parentElement?.getBoundingClientRect().width) return;
      let node: HTMLElement | null = anchor.parentElement;
      while (node) {
        ancestors.push(node);
        node.classList.add('candidate-print-ancestor');
        node = node.parentElement;
      }
    };
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', restore);
    return () => {
      restore();
      window.removeEventListener('beforeprint', prepare);
      window.removeEventListener('afterprint', restore);
    };
  }, []);
  const state = openGroups ?? localOpen;
  const setOpen = (group: string, open: boolean) =>
    onGroupOpen ? onGroupOpen(group, open) : setLocalOpen((old) => ({ ...old, [group]: open }));
  const visible = groups
    .map((group) => ({ ...group, races: races.filter((race) => race.group === group.key) }))
    .filter((group) => group.races.length);
  const jump = (group: string) => {
    setOpen(group, true);
    requestAnimationFrame(() => {
      const node = document.getElementById(`${id}-${group}-toggle`);
      node?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      node?.focus({ preventScroll: true });
    });
  };
  if (!visible.length)
    return (
      <CandidateNotice>
        <Text style={candidateText.strong}>
          No candidate records to show for this address and election
        </Text>
      </CandidateNotice>
    );
  return (
    <View aria-busy={busy || undefined}>
      {Platform.OS === 'web' ? (
        <>
          <style>{groupCss}</style>
          <nav ref={printAnchor} aria-label="Office groups" className="candidate-jumps">
            {visible.map((group) => (
              <a
                key={group.key}
                href={`#${id}-${group.key}-toggle`}
                aria-label={group.name}
                className="candidate-jump"
                style={
                  {
                    '--tint': group.tint,
                    '--edge': group.edge,
                    '--dot': group.dot,
                    '--press': group.press,
                  } as CSSProperties
                }
                onClick={(event) => {
                  event.preventDefault();
                  jump(group.key);
                }}
              >
                <span aria-hidden="true" />
                {group.short}
              </a>
            ))}
          </nav>
        </>
      ) : null}
      <View style={styles.groups}>
        {visible.map((group) => {
          const expanded = state[group.key] !== false;
          const judges =
            group.key === 'state'
              ? group.races
                  .filter(isJudicial)
                  .sort(
                    (a, b) =>
                      judicialRank(a) - judicialRank(b) ||
                      a.office.localeCompare(b.office, 'en', { numeric: true }),
                  )
              : [];
          const ordinary = group.races.filter((race) => !judges.includes(race));
          const shared = group.races.every((race) => sameSource(race.source, group.races[0].source))
            ? group.races[0].source
            : null;
          const cards = (list: CandidateRace[], judicial = false) =>
            list.map((race) => (
              <CandidateRaceCard
                key={race.id}
                race={race}
                election={election}
                onOpenProfile={onOpenProfile}
                showSource={!shared}
                judicial={judicial}
              />
            ));
          const judgesOpen = state.judges === true;
          return (
            <View key={group.key} style={styles.group}>
              {Platform.OS === 'web' ? (
                <h2 style={{ margin: 0 }}>
                  <button
                    type="button"
                    id={`${id}-${group.key}-toggle`}
                    className="candidate-group-toggle"
                    aria-expanded={expanded}
                    aria-controls={`${id}-${group.key}-body`}
                    style={
                      {
                        '--tint': group.tint,
                        '--edge': group.edge,
                        '--dot': group.dot,
                        '--press': group.press,
                      } as CSSProperties
                    }
                    onClick={() => setOpen(group.key, !expanded)}
                  >
                    <span className="candidate-group-swatch" aria-hidden="true" />
                    <span className="candidate-group-title">
                      <span style={{ fontSize: isMobile ? 24 : isDesktop ? 28 : 26 }}>
                        {group.name}
                      </span>
                      <span className="candidate-race-count">
                        {group.races.length} {group.races.length === 1 ? 'race' : 'races'}
                      </span>
                    </span>
                    <Chevron open={expanded} />
                  </button>
                </h2>
              ) : (
                <Text style={styles.groupHeading}>{group.name}</Text>
              )}
              <CollapsibleBody
                id={`${id}-${group.key}-body`}
                open={expanded}
                onReveal={() => setOpen(group.key, true)}
              >
                {shared ? <CandidateSourceLine source={shared} group /> : null}
                <View style={{ marginTop: 14, gap: 12 }}>
                  {cards(ordinary)}
                  {judges.length ? (
                    <View style={styles.judges}>
                      <h3 style={{ margin: 0 }}>
                        <button
                          type="button"
                          className="candidate-judges-toggle"
                          aria-expanded={judgesOpen}
                          aria-controls={`${id}-judges-body`}
                          onClick={() => setOpen('judges', !judgesOpen)}
                        >
                          <span className="candidate-judges-swatch" aria-hidden="true" />
                          <span className="candidate-group-title">
                            <span style={{ fontSize: isMobile ? 19 : isDesktop ? 21 : 20 }}>
                              Judges
                            </span>
                            <span className="candidate-race-count" style={{ fontSize: 15 }}>
                              {judges.length} {judges.length === 1 ? 'race' : 'races'}
                            </span>
                          </span>
                          <Chevron open={judgesOpen} size={18} />
                        </button>
                      </h3>
                      <CollapsibleBody
                        id={`${id}-judges-body`}
                        open={judgesOpen}
                        onReveal={() => {
                          setOpen('state', true);
                          setOpen('judges', true);
                        }}
                      >
                        <View style={{ padding: isMobile ? 8 : 12, paddingTop: 0, gap: 12 }}>
                          {cards(judges, true)}
                        </View>
                      </CollapsibleBody>
                    </View>
                  ) : null}
                </View>
              </CollapsibleBody>
            </View>
          );
        })}
      </View>
    </View>
  );
}
const groupCss = `
.candidate-jumps{display:flex;flex-wrap:wrap;gap:8px}
.candidate-jump{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:0 16px;border:1px solid var(--edge);border-radius:12px;background:var(--tint);font:700 15.5px 'Libre Franklin',sans-serif;color:#11150f;text-decoration:none;white-space:nowrap}
.candidate-jump>span{width:10px;height:10px;border-radius:3px;background:var(--dot);flex:none}
.candidate-group-toggle,.candidate-judges-toggle{width:100%;display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 16px;border:1px solid var(--edge);border-radius:14px;background:var(--tint);font-family:'Libre Franklin',sans-serif;color:#11150f;text-align:left;cursor:pointer;scroll-margin-top:24px}
.candidate-group-title{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;font-weight:800;line-height:1.15;letter-spacing:-.015em}
.candidate-race-count{font-size:16px;font-weight:700;color:#4f5651;font-variant-numeric:tabular-nums;letter-spacing:0}
.candidate-group-swatch{flex:none;width:14px;height:14px;border-radius:4px;background:var(--dot)}
.candidate-judges-toggle{min-height:56px;border:0;background:transparent}
.candidate-judges-swatch{flex:none;width:12px;height:12px;border:2px solid #15834a;border-radius:3px;box-sizing:border-box}
.candidate-chevron{transition:transform .16s ease}
.candidate-group-toggle:focus-visible,.candidate-jump:focus-visible,.candidate-judges-toggle:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
.candidate-group-toggle:focus:not(:focus-visible),.candidate-jump:focus:not(:focus-visible),.candidate-judges-toggle:focus:not(:focus-visible){outline:none}
@media(hover:hover) and (min-width:768px){.candidate-group-toggle:hover,.candidate-jump:hover{border-color:var(--dot)}.candidate-judges-toggle:hover{background:#d6efe1}}
.candidate-group-toggle:active,.candidate-jump:active{background:var(--press);border-color:var(--dot)}.candidate-judges-toggle:active{background:#a8dcbf}
@media(prefers-reduced-motion:reduce){.candidate-chevron{transition:none}}
@media print{.candidate-print-ancestor{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;position:static!important;display:block!important;flex:none!important;transform:none!important}.candidate-group-body[hidden]{display:block!important;content-visibility:visible!important}.candidate-jumps{display:none}.candidate-chevron{transform:rotate(180deg)!important}}
`;
const styles = StyleSheet.create({
  groups: { gap: 32, marginTop: 24 },
  group: {},
  groupHeading: { ...candidateText.title, fontSize: 24, lineHeight: 30 },
  judges: { backgroundColor: '#e8f6ee', borderColor: '#a8dcbf', borderWidth: 1, borderRadius: 14 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
  },
  raceHeader: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    columnGap: 18,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  raceWords: { flexGrow: 1, flexShrink: 1, minWidth: 0, flexBasis: 240 },
  office: { ...candidateText.title, fontSize: 18, lineHeight: 24 },
  area: { ...candidateText.body, fontSize: 15, lineHeight: 21, marginTop: 3 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metadata: { ...candidateText.strong, fontSize: 14, lineHeight: 21, color: '#4f5651' },
  ticketHelp: {
    ...candidateText.body,
    fontSize: 14.5,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingBottom: 12,
    marginTop: -4,
  },
  entry: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  person: {
    minHeight: 64,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 4,
  },
  personName: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: '#11150f',
  },
  empty: { padding: 18, gap: 3, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  coverage: {
    gap: 14,
    padding: 18,
    backgroundColor: '#f2f4f3',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 14,
  },
  coverageHeading: { ...candidateText.title, fontSize: 18, lineHeight: 25 },
  gap: {
    backgroundColor: '#fff',
    borderColor: '#efd9a8',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  ballot: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)', paddingTop: 12, gap: 2 },
});
