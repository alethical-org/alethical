import { useCallback, useEffect, useState } from 'react';

import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import { EMPTY_YEAR_VALUE } from '@alethical/shared/committeeMoney';
import {
  MONEY_IN_REPORTED_LABEL,
  moneyOutSummary,
  registerKindLabel,
} from '@alethical/shared/committeeMoneyShared';
import { otherOfficeNote, reportedThroughLabel } from '@alethical/shared/legislatorCampaignMoney';
import { formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { billSession } from '../search/suggestions';
import { useAddressState } from '../ui/addressState';
import { Chips, Refused } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates, type SourceGroup } from '../ui/parts';
import './committeeMembers.css';

/**
 * Committee members' campaign accounts (Committee Members Accounts drawing,
 * build notes rounds 19 to 21): each member side by side with their own
 * confirmed campaign accounts and each account's own report figures for the
 * chosen year. Figures are never combined across members or accounts
 * (`.claude/rules/grounded-answers.md` rule 12), and each member's figures are
 * read on their own (docs/architecture/alethical-finance-architecture.md §2).
 */

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const LEGISLATURE = 'Minnesota Legislature';
/** The year chips: the newest 3 campaign-money years. */
const YEAR_CHOICES = 3;

export interface ConfirmedAccount {
  registration_number: string;
  committee_name: string | null;
  office: string | null;
  for_legislative_office: boolean;
}

export interface Member {
  id: string;
  slug: string | null;
  name: string;
  role: string | null;
  campaign_accounts: {
    link_state: 'confirmed' | 'reviewed_none_confirmed' | 'unconfirmed';
    confirmed: ConfirmedAccount[];
  };
}

export interface MembersAnswer {
  committee: {
    id: string;
    name: string;
    chamber: string | null;
    session: string | null;
    members_are_current: boolean;
  };
  members: Member[];
}

export interface FiguresCommittee {
  registration_number: string;
  register_kind?: string | null;
  filings_copied_at?: string | null;
  split?: { reported_total: string | null; reported_through: string | null } | null;
  money_out?: { reported_total: string | null; reported_through: string | null } | null;
}

export interface FiguresAnswer {
  year: number;
  filings_copied_at: string | null;
  committees: FiguresCommittee[];
}

/** "House" from "Minnesota House of Representatives". */
export function chamberName(chamber: string | null): string | null {
  if (!chamber) return null;
  if (/house/i.test(chamber)) return 'House';
  if (/senate/i.test(chamber)) return 'Senate';
  return chamber;
}

/** "House · 2025–26 session · 27 members". */
export function committeeMeta(answer: MembersAnswer): string {
  const session = answer.committee.session ? billSession(answer.committee.session) : null;
  const count = answer.members.length;
  return [
    chamberName(answer.committee.chamber),
    session && `${session} session`,
    `${count} ${count === 1 ? 'member' : 'members'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface Figure {
  label: string;
  value: string;
  missing: boolean;
  /** This figure's own report period, set only when the 2 figures' reports end
   * on different days; otherwise the account's shared `period` covers both. */
  period?: string;
}

export type AccountFigures =
  | { state: 'none' }
  | { state: 'figures'; figures: Figure[]; notes: string[]; period: string | null };

/**
 * 1 account's figures for the year, as its filing states them: the report's
 * contributions total and its expenditures total. A missing total is never $0,
 * and an account with neither total held has no report for the year. Each total
 * states the period its report covers.
 */
export function accountFigures(committee: FiguresCommittee | undefined): AccountFigures {
  const contributions = committee?.split?.reported_total ?? null;
  const spending = committee?.money_out ?? null;
  if (!committee || (contributions === null && (spending?.reported_total ?? null) === null)) {
    return { state: 'none' };
  }
  const contributionsText = formatMoney(contributions);
  const figures: Array<Figure & { through: string | null }> = [
    {
      label: MONEY_IN_REPORTED_LABEL,
      value: contributionsText ?? EMPTY_YEAR_VALUE,
      missing: contributionsText === null,
      through: contributionsText !== null ? (committee.split?.reported_through ?? null) : null,
    },
  ];
  const out = moneyOutSummary(spending ? { reportedTotal: spending.reported_total } : null);
  if (out.label && out.amount !== null) {
    figures.push({
      label: out.label,
      value: out.amount,
      missing: false,
      through: spending?.reported_through ?? null,
    });
  }
  const throughs = [...new Set(figures.map((figure) => figure.through).filter(Boolean))];
  const shared = throughs.length === 1 ? reportedThroughLabel(throughs[0]) : null;
  return {
    state: 'figures',
    figures: figures.map(({ through, ...figure }) => {
      const own = throughs.length > 1 ? reportedThroughLabel(through) : null;
      return own ? { ...figure, period: own } : figure;
    }),
    notes: out.notes,
    period: shared,
  };
}

export function CommitteeMembers({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const years = campaignMoneyHistoryYears().slice(0, YEAR_CHOICES).map(String);
  const [choice, setChoice] = useAddressState({ year: years[0] });
  const year = years.includes(choice.year) ? choice.year : years[0];
  const read = useRead<MembersAnswer>(
    `finance/legislative-committees/${encodeURIComponent(match.params.id)}/members`,
  );
  const answer = read.data;
  // Each member's own read reports the date its report totals were copied, so
  // the page states 1 copy date without reading every member's figures itself.
  const [copied, setCopied] = useState<{ year: string; dates: Record<string, string> }>({
    year,
    dates: {},
  });
  const onCopied = useCallback(
    (memberId: string, forYear: string, date: string) =>
      setCopied((current) => {
        const dates = current.year === forYear ? current.dates : {};
        if (dates[memberId] === date) return current;
        return { year: forYear, dates: { ...dates, [memberId]: date } };
      }),
    [],
  );
  const copiedText = copied.year === year ? copiedLine(Object.values(copied.dates)) : null;

  if (read.notFound) {
    return (
      <main id="main" className="f-page">
        <div className="f-content">
          {back && <BackLink to={back.to} name={back.name} />}
          <h1 tabIndex={-1} className="f-page-title cmm-gone">
            This record is no longer available
          </h1>
        </div>
      </main>
    );
  }

  const groups: SourceGroup[] = [
    { source: LEGISLATURE, items: ['Committee roster'] },
    {
      source: BOARD,
      items: [
        copiedText
          ? `Campaign accounts and report figures, ${copiedText}`
          : 'Campaign accounts and report figures',
        'Each account is linked to its member only once confirmed',
      ],
    },
  ];

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="cmm-head">
          <span className="f-label">Legislative committee</span>
          <h1 tabIndex={-1} className="f-page-title cmm-title">
            {answer?.committee.name ?? 'Committee members’ campaign accounts'}
          </h1>
          {answer && <span className="cmm-meta">{committeeMeta(answer)}</span>}
        </header>
        <section aria-labelledby="members-h" className="cmm-section">
          <div className="cmm-section-head">
            <h2 id="members-h" className="f-section-title">
              Members’ campaign accounts
            </h2>
            <div className="cmm-years">
              <span className="cmm-years-label" aria-hidden="true">
                Year
              </span>
              <Chips
                label="Year"
                value={year}
                options={years.map((value) => ({ value, label: value }))}
                onChange={(value) => setChoice({ year: value })}
              />
            </div>
          </div>
          <p className="cmm-lead">
            Each member’s own confirmed campaign account, with figures from its latest report in the
            chosen year. Figures are never combined across members.
          </p>
          {read.loading && (
            <div className="cmm-box">
              <LoadingLine>Loading members’ campaign accounts…</LoadingLine>
            </div>
          )}
          {read.failed && (
            <div className="cmm-state">
              <Refused onRetry={read.retry} retrying={read.pending}>
                We couldn’t load these accounts. This is a problem on our side and says nothing
                about the members.
              </Refused>
            </div>
          )}
          {answer && !read.failed && answer.members.length === 0 && (
            <div className="f-empty-box cmm-state">
              No members are recorded for this committee in the copied Legislature records
            </div>
          )}
          {answer && !read.failed && answer.members.length > 0 && (
            <ul className="cmm-grid">
              {answer.members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  year={year}
                  here={here}
                  onCopied={onCopied}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      <SourcesAndUpdates groups={groups} />
    </main>
  );
}

function MemberCard({
  member,
  year,
  here,
  onCopied,
}: {
  member: Member;
  year: string;
  here: string;
  onCopied: (memberId: string, year: string, date: string) => void;
}) {
  const confirmed =
    member.campaign_accounts.link_state === 'confirmed' ? member.campaign_accounts.confirmed : [];
  const accounts = confirmed.filter((account) => account.for_legislative_office);
  const otherOffice = confirmed.length - accounts.length;
  // 1 member's own read, never a request for the whole committee.
  const figures = useRead<FiguresAnswer>(
    accounts.length > 0
      ? `legislators/${encodeURIComponent(member.id)}/campaign-finance?year=${year}`
      : null,
  );
  const date = figures.data?.year === Number(year) ? figures.data.filings_copied_at : null;
  useEffect(() => {
    if (date) onCopied(member.id, year, date);
  }, [date, member.id, onCopied, year]);
  const memberHref = isBuilt('legislator')
    ? withFrom(hrefFor('legislator', { id: member.id }), here)
    : null;
  const otherNote = otherOfficeNote(otherOffice);

  return (
    <li className="cmm-card">
      <div className="cmm-who">
        {memberHref ? (
          <Link to={memberHref} className="cmm-name">
            {member.name}
          </Link>
        ) : (
          <span className="cmm-name">{member.name}</span>
        )}
        {member.role && <span className="cmm-sub">{member.role}</span>}
      </div>
      {accounts.length === 0 && !otherNote && (
        <p className="cmm-rule cmm-line">No campaign account is confirmed for this member</p>
      )}
      {accounts.length > 0 && (
        <div className="cmm-rule cmm-accounts">
          <span className="f-label">
            {accounts.length > 1 ? 'Campaign accounts' : 'Campaign account'}
          </span>
          {figures.loading && <LoadingLine>Loading…</LoadingLine>}
          {figures.failed && (
            <Refused onRetry={figures.retry} retrying={figures.pending}>
              We couldn’t load these accounts. This is a problem on our side and says nothing about
              the members.
            </Refused>
          )}
          {figures.data &&
            accounts.map((account) => (
              <Account
                key={account.registration_number}
                account={account}
                served={figures.data?.committees.find(
                  (item) => item.registration_number === account.registration_number,
                )}
                year={year}
                here={here}
              />
            ))}
        </div>
      )}
      {otherNote && <p className="cmm-rule cmm-line">{otherNote}</p>}
    </li>
  );
}

function Account({
  account,
  served,
  year,
  here,
}: {
  account: ConfirmedAccount;
  served: FiguresCommittee | undefined;
  year: string;
  here: string;
}) {
  const reg = account.registration_number;
  const name = account.committee_name ?? `Registration ${reg}`;
  const href = isBuilt('committee')
    ? withFrom(hrefFor('committee', { id: reg }, { year }), here)
    : null;
  const kind = registerKindLabel(served?.register_kind);
  const result = accountFigures(served);
  return (
    <div className="cmm-account">
      <div className="cmm-who">
        {href ? (
          <Link to={href} className="cmm-account-name">
            {name}
          </Link>
        ) : (
          <span className="cmm-account-name">{name}</span>
        )}
        <span className="cmm-sub">
          {kind ? `${kind} · Registration ${reg}` : `Registration ${reg}`}
        </span>
      </div>
      {result.state === 'none' ? (
        <p className="cmm-line">No report for {year} is held for this account</p>
      ) : (
        <>
          <dl className="cmm-figures">
            {result.figures.map((figure) => (
              <div key={figure.label} className="cmm-figure">
                <dt>{figure.label}</dt>
                <dd className="cmm-value" data-missing={figure.missing || undefined}>
                  {figure.value}
                </dd>
                {figure.period && <dd className="cmm-report cmm-figure-period">{figure.period}</dd>}
              </div>
            ))}
          </dl>
          {result.notes.map((note) => (
            <p key={note} className="cmm-line">
              {note}
            </p>
          ))}
          {result.period && <span className="cmm-report">{result.period}</span>}
        </>
      )}
    </div>
  );
}

/** The report totals' copy date for the Sources line, from the members' own
 * reads. Exported for the test; the page reads it through `copiedLine`. */
export function copiedLine(dates: Array<string | null | undefined>): string | null {
  const labels = [...new Set(dates.filter(Boolean).map((date) => centralDateLabel(date!)))];
  return labels.length > 0 ? `report totals copied ${labels.join(' and ')}` : null;
}
