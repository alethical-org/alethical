import type { ReactNode } from 'react';

import { useRead } from '../api/read';
import { returnTarget, withFrom } from '../returnContext';
import { Link, useLocation } from '../router';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Chips, Refused, type Option } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates, WithArrow } from '../ui/parts';
import {
  billCode,
  billPath,
  chamberName,
  dayLabel,
  votesPath,
  type BillDetail,
  type ServedVote,
  type VoteRecord,
} from './legislationRecords';
import './legislation.css';

/** Each recorded vote value in reader words, in the order the filters show them. */
const RECORDED: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
  { value: 'present', label: 'Present' },
  { value: 'abstain', label: 'Abstain' },
];

export function recordedLabel(value: string): string {
  return RECORDED.find((item) => item.value === value)?.label ?? value;
}

export interface Tally {
  label: string;
  value: number;
}

/**
 * The tallies the record states. Yes and No are always shown. Absent, Excused
 * and Present are shown only when the record holds a count above 0 for them:
 * those columns read 0 when the source carried nothing, so a 0 there is not a
 * recorded zero.
 */
export function rollTallies(vote: ServedVote): Tally[] {
  const tallies: Tally[] = [];
  if (vote.yes_count != null) tallies.push({ label: 'Yes', value: vote.yes_count });
  if (vote.no_count != null) tallies.push({ label: 'No', value: vote.no_count });
  for (const [label, value] of [
    ['Absent', vote.absent_count],
    ['Excused', vote.excused_count],
    ['Present', vote.present_count],
  ] as const) {
    if (typeof value === 'number' && value > 0) tallies.push({ label, value });
  }
  return tallies;
}

/** The filter choices: All, then each value at least 1 member is recorded as. */
export function recordedFilters(records: VoteRecord[]): Option<string>[] {
  const held = new Set(records.map((record) => record.vote_value));
  return [
    { value: 'all', label: 'All' },
    ...RECORDED.filter((item) => held.has(item.value)).map((item) => ({
      value: item.value,
      label: item.label,
    })),
  ];
}

export function matchingMembers(records: VoteRecord[], recorded: string, query: string) {
  const q = query.trim().toLowerCase();
  return records.filter(
    (record) =>
      (recorded === 'all' || record.vote_value === recorded) &&
      (!q || (record.legislator_name ?? '').toLowerCase().includes(q)),
  );
}

/** "www.senate.mn" from the roll call's own record address. */
function sourceHost(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * Roll call (Vote drawing): 1 recorded motion with its exact wording, date,
 * recorded result and members. No route serves a roll call by its own id, so
 * the address names the bill too (`?bill=`), and the roll call is read from
 * that bill's recorded roll calls.
 */
export function RollCall({ match }: { match: RouteMatch }) {
  const id = match.params.id ?? '';
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({ bill: '', recorded: 'all', q: '' });
  const billId = address.bill.trim();
  const votes = useRead<ServedVote[]>(billId ? votesPath(billId) : null);
  const bill = useRead<BillDetail>(billId ? billPath(billId) : null);
  const vote = votes.data?.find((item) => item.id === id) ?? null;

  if (!billId || votes.notFound || (votes.data && !vote)) {
    return (
      <Frame back={back}>
        <section className="f-card lg-unavailable">
          <h1 tabIndex={-1} className="lg-unavailable-title">
            This record is no longer available
          </h1>
          <p>
            No roll call with this reference is in the current copy. Open the bill’s Votes tab for
            the recorded roll calls.
          </p>
        </section>
      </Frame>
    );
  }
  if (votes.loading) {
    return (
      <Frame back={back}>
        <LoadingLine>Loading…</LoadingLine>
      </Frame>
    );
  }
  if (!vote) {
    return (
      <Frame back={back}>
        <Refused onRetry={votes.retry} retrying={votes.pending}>
          We couldn’t load this bill’s votes right now. Please try again in a moment.
        </Refused>
      </Frame>
    );
  }

  const records = vote.records ?? [];
  const filters = recordedFilters(records);
  const recorded = filters.some((item) => item.value === address.recorded)
    ? address.recorded
    : 'all';
  const members = matchingMembers(records, recorded, address.q);
  const code = billCode(null, null, billId);
  const chamber = chamberName(vote.chamber);
  const date = dayLabel(vote.occurred_at);
  const shortTitle = bill.data?.ai_analysis?.short_title?.trim() || null;
  const tallies = rollTallies(vote);
  const host = sourceHost(vote.official_url);
  const updatedDay = dayLabel(bill.data?.last_pulled_at);
  const sourceLine = [
    'Minnesota Legislature',
    host ?? 'revisor.mn.gov',
    updatedDay ? `Updated ${updatedDay}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const journal =
    chamber && date && /journal/i.test(vote.official_url ?? '')
      ? `. Journal of the ${chamber}, ${date}`
      : '';
  const billHref = isBuilt('bill') ? withFrom(hrefFor('bill', { id: billId }), here) : null;

  return (
    <Frame
      back={back}
      sources={
        <SourcesAndUpdates>
          <p className="f-sources-line">
            {sourceLine}
            {journal}
          </p>
          {vote.official_url && (
            <a
              href={vote.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="f-dest f-sources-link"
            >
              <span>
                <WithArrow>Official source website</WithArrow>
              </span>
              <span className="f-visually-hidden"> (opens in a new tab)</span>
            </a>
          )}
        </SourcesAndUpdates>
      }
    >
      <header className="bl-header">
        <div className="bl-tags">
          <span className="rc-tag">ROLL CALL</span>
          {code &&
            (billHref ? (
              <Link to={billHref} className="f-code bl-companion">
                {code}
              </Link>
            ) : (
              <span className="f-code">{code}</span>
            ))}
          <span className="bl-session">{[chamber, date].filter(Boolean).join(' · ')}</span>
        </div>
        <h1 tabIndex={-1} className="f-page-title bl-title">
          {vote.motion_text?.trim() || 'Roll call'}
        </h1>
        {shortTitle && <p className="rc-bill-title">{shortTitle}</p>}
      </header>

      <div className="bl-layout">
        <section aria-labelledby="members-heading" className="bl-main">
          <div className="f-card">
            <div className="rc-result-head">
              <span className="rc-result">
                Recorded result · {vote.result_text?.trim() || 'Not held in this copy'}
              </span>
              <span className="bl-meta-inline">
                {records.length.toLocaleString('en-US')} members recorded
              </span>
            </div>
            <dl className="rc-tallies" data-count={tallies.length}>
              {tallies.map((tally) => (
                <div key={tally.label} className="rc-tally">
                  <dt>{tally.label}</dt>
                  <dd>{tally.value.toLocaleString('en-US')}</dd>
                </div>
              ))}
            </dl>
            <p className="bl-meta">
              Only what the Legislature’s record states is shown. Members not recorded are not
              inferred absent. A vote result differs from the bill’s eventual status.
            </p>
          </div>

          <div className="rc-members-head">
            <h2 id="members-heading" className="f-section-title">
              Members
            </h2>
            <Chips
              label="Recorded as"
              value={recorded}
              options={filters}
              onChange={(value) => setAddress({ recorded: value })}
            />
          </div>
          <label className="rc-search">
            <span className="f-visually-hidden">Search members</span>
            <input
              type="search"
              className="f-field rc-search-field"
              value={address.q}
              onChange={(event) => setAddress({ q: event.target.value })}
              placeholder="Search members"
              autoComplete="off"
            />
          </label>
          {members.length === 0 ? (
            <div className="f-empty-box rc-none">No recorded member matches that</div>
          ) : (
            <>
              <div role="table" aria-label="Members" className="rc-table">
                <div role="row" className="rc-row rc-row-head">
                  <span role="columnheader">MEMBER</span>
                  <span role="columnheader">PARTY</span>
                  <span role="columnheader">RECORDED</span>
                </div>
                {members.map((member) => (
                  <MemberRow key={member.legislator_id} member={member} here={here} />
                ))}
              </div>
              <p className="lg-note">
                A member’s record here is a vote on one motion, never a position or an opinion.
                Names link only where a legislator record is confirmed.
              </p>
            </>
          )}
        </section>
      </div>
    </Frame>
  );
}

function MemberRow({ member, here }: { member: VoteRecord; here: string }) {
  const name = member.legislator_name?.trim() || null;
  const href =
    name && member.legislator_id && isBuilt('legislator')
      ? withFrom(hrefFor('legislator', { id: member.legislator_id }), here)
      : null;
  return (
    <div role="row" className="rc-row">
      <span role="cell" className="rc-name">
        {href ? (
          <Link to={href} className="bl-name-link">
            {name}
          </Link>
        ) : (
          <span className={name ? 'bl-name' : 'bl-muted'}>{name ?? 'Not held in this copy'}</span>
        )}
      </span>
      <span role="cell" className={member.party ? 'rc-party' : 'rc-party bl-muted'}>
        {member.party?.trim() || 'Party not recorded'}
      </span>
      <span role="cell" className="rc-vote">
        {recordedLabel(member.vote_value)}
      </span>
    </div>
  );
}

function Frame({
  back,
  sources,
  children,
}: {
  back: { to: string; name: string } | null;
  /** "Sources and updates", only once the record is shown. */
  sources?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" className="f-page bl-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {children}
      </div>
      {sources}
    </main>
  );
}
