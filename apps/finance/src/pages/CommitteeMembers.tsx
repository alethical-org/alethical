import { useCallback, useEffect, useMemo, useState } from "react";

import { campaignMoneyHistoryYears } from "@alethical/shared/campaignMoneyYears";
import { EMPTY_YEAR_VALUE } from "@alethical/shared/committeeMoney";
import { registerKindLabel } from "@alethical/shared/committeeMoneyShared";
import {
  REPORT_LOAD_ERROR,
  reportPeriodLine,
} from "@alethical/shared/committeePaymentsPage";
import { otherOfficeNote } from "@alethical/shared/legislatorCampaignMoney";
import { formatDay, formatMoney } from "../ui/money";
import { centralDateLabel } from "@alethical/shared/moneyLanding";

import { apiPath, useRead } from "../api/read";
import { Link, useLocation } from "../router";
import { returnTarget, withFrom } from "../returnContext";
import { hrefFor, isBuilt, type RouteMatch } from "../routes";
import { billSession } from "../search/suggestions";
import { useAddressState } from "../ui/addressState";
import { Chips, Refused } from "../ui/controls";
import {
  BackLink,
  LoadingLine,
  SourcesAndUpdates,
  type SourceGroup,
} from "../ui/parts";
import { reportFigureLabel } from "./committee/Figures";
import type { ReportFigures } from "./committee/types";
import "./committeeMembers.css";

/**
 * Committee members' campaign accounts (Committee Members Accounts drawing,
 * build notes rounds 19 to 21): each member side by side with their own
 * confirmed campaign accounts and each account's own report figures for the
 * chosen year. Figures are never combined across members or accounts
 * (`.claude/rules/grounded-answers.md` rule 12), and each member's figures are
 * read on their own (docs/architecture/alethical-finance-architecture.md §2).
 */

const BOARD = "Minnesota Campaign Finance and Public Disclosure Board";
const LEGISLATURE = "Minnesota Legislature";
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
  roles?: string[];
  district?: string | null;
  campaign_accounts: {
    link_state: "confirmed" | "reviewed_none_confirmed" | "unconfirmed";
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
}

export interface FiguresAnswer {
  year: number;
  filings_copied_at: string | null;
  committees: FiguresCommittee[];
}

/** "House" from "Minnesota House of Representatives". */
export function chamberName(chamber: string | null): string | null {
  if (!chamber) return null;
  if (/house/i.test(chamber)) return "House";
  if (/senate/i.test(chamber)) return "Senate";
  return chamber;
}

/**
 * 1 entry per person. The roster can list an officer twice, once without a role
 * and once with it (Co-Chair, Alternate); the entries are 1 member, so they are
 * joined by id, keeping each distinct role in served order.
 */
export function uniqueMembers(members: Member[]): Member[] {
  const byId = new Map<string, Member>();
  for (const member of members) {
    const roles = member.roles ?? (member.role ? [member.role] : []);
    const held = byId.get(member.id);
    if (!held) {
      byId.set(member.id, { ...member, roles: [...new Set(roles)] });
      continue;
    }
    byId.set(member.id, {
      ...held,
      roles: [...new Set([...(held.roles ?? []), ...roles])],
      district: held.district ?? member.district,
    });
  }
  return [...byId.values()];
}

/** "House · 2025–26 session · 27 members". */
export function committeeMeta(answer: MembersAnswer): string {
  const session = answer.committee.session
    ? billSession(answer.committee.session)
    : null;
  const count = answer.members.length;
  return [
    chamberName(answer.committee.chamber),
    session && `${session} session`,
    `${count} ${count === 1 ? "member" : "members"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface Figure {
  label: string;
  value: string;
  missing: boolean;
}

export type AccountFigures =
  | { state: "none" }
  | { state: "figures"; figures: Figure[]; report: string | null };

/**
 * 1 account's figures for the year, read the way Committee reads them: the
 * report whose figures the server holds for the year (`figures_state:
 * 'reported'`), with its Total receipts, Total expenditures and Ending balance
 * as filed, and the report's name and period. A figure the report does not give
 * us reads "Report total unavailable", never $0 (grounded-answers rule 12); an
 * account with no such report has no report for the year.
 */
export function accountFigures(
  answer: ReportFigures | null | undefined,
): AccountFigures {
  const row = answer?.reports.find((item) => item.figures_state === "reported");
  if (!row) return { state: "none" };
  const box = (label: string, amount: string | null): Figure => {
    const value = formatMoney(amount);
    return { label, value: value ?? EMPTY_YEAR_VALUE, missing: value === null };
  };
  const first = formatDay(row.period_start);
  const last = formatDay(row.cut_off_date);
  const period =
    first && last
      ? `${first} to ${last}`
      : reportPeriodLine(row.cut_off_date, null);
  const report = [reportFigureLabel(row), period].filter(Boolean).join(" · ");
  return {
    state: "figures",
    figures: [
      box("Total receipts", row.total_receipts),
      box("Total expenditures", row.total_expenditures),
      box("Ending balance", row.ending_cash_balance),
    ],
    report: report || null,
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
    apiPath(["finance", "legislative-committees", match.params.id, "members"]),
  );
  const answer = useMemo(
    () =>
      read.data
        ? { ...read.data, members: uniqueMembers(read.data.members) }
        : undefined,
    [read.data],
  );
  // Each member's own read reports the date its report totals were copied, so
  // the page states 1 copy date without reading every member's figures itself.
  const [copied, setCopied] = useState<{
    year: string;
    dates: Record<string, string>;
  }>({
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
  const copiedText =
    copied.year === year ? copiedLine(Object.values(copied.dates)) : null;

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
    { source: LEGISLATURE, items: ["Committee roster"] },
    {
      source: BOARD,
      items: [
        copiedText
          ? `Campaign accounts and report figures, ${copiedText}`
          : "Campaign accounts and report figures",
        "Each account is linked to its member only once confirmed",
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
            {answer?.committee.name ?? "Committee members’ campaign accounts"}
          </h1>
          {answer && <span className="cmm-meta">{committeeMeta(answer)}</span>}
        </header>
        <section aria-labelledby="members-h" className="cmm-section">
          <div className="cmm-section-head">
            <h2 id="members-h" className="f-section-title">
              Members’ campaign accounts
            </h2>
            <div className="f-labeled-chips cmm-years">
              <span className="f-labeled-chips-label" aria-hidden="true">
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
            Each member’s own confirmed campaign account, with figures from its
            latest report in the chosen year. Figures are never combined across
            members.
          </p>
          {read.loading && (
            <div className="cmm-box">
              <LoadingLine>Loading members’ campaign accounts…</LoadingLine>
            </div>
          )}
          {read.failed && (
            <div className="cmm-state">
              <Refused onRetry={read.retry} retrying={read.pending}>
                Couldn’t load accounts. This is a problem on our side and says
                nothing about the members.
              </Refused>
            </div>
          )}
          {answer && !read.failed && answer.members.length === 0 && (
            <div className="f-empty-box cmm-state">
              No members are recorded for this committee in the copied
              Legislature records
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
    member.campaign_accounts.link_state === "confirmed"
      ? member.campaign_accounts.confirmed
      : [];
  const accounts = confirmed.filter(
    (account) => account.for_legislative_office,
  );
  const otherOffice = confirmed.length - accounts.length;
  // 1 member's own read, never a request for the whole committee.
  const figures = useRead<FiguresAnswer>(
    accounts.length > 0
      ? apiPath(["legislators", member.id, "campaign-finance"], { year })
      : null,
  );
  const date =
    figures.data?.year === Number(year) ? figures.data.filings_copied_at : null;
  useEffect(() => {
    if (date) onCopied(member.id, year, date);
  }, [date, member.id, onCopied, year]);
  const memberHref = isBuilt("legislator")
    ? withFrom(hrefFor("legislator", { id: member.id }), here)
    : null;
  const otherNote = otherOfficeNote(otherOffice);
  const memberMeta = [
    member.roles?.join(", "),
    member.district && `District ${member.district}`,
  ]
    .filter(Boolean)
    .join(" · ");

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
        {memberMeta && <span className="cmm-sub">{memberMeta}</span>}
      </div>
      {accounts.length === 0 && !otherNote && (
        <p className="cmm-rule cmm-line">
          No campaign account is confirmed for this member
        </p>
      )}
      {accounts.length > 0 && (
        <div className="cmm-rule cmm-accounts">
          <span className="f-label">
            {accounts.length > 1 ? "Campaign accounts" : "Campaign account"}
          </span>
          {figures.loading && <LoadingLine>Loading…</LoadingLine>}
          {figures.failed && (
            <Refused onRetry={figures.retry} retrying={figures.pending}>
              Couldn’t load accounts. This is a problem on our side and says
              nothing about the members.
            </Refused>
          )}
          {figures.data &&
            accounts.map((account) => (
              <Account
                key={account.registration_number}
                account={account}
                served={figures.data?.committees.find(
                  (item) =>
                    item.registration_number === account.registration_number,
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
  const name = account.committee_name ?? `Registration number ${reg}`;
  const href = isBuilt("committee")
    ? withFrom(hrefFor("committee", { id: reg }, { year }), here)
    : null;
  const kind = registerKindLabel(served?.register_kind);
  // The account's own report figures, the read Committee's Official report
  // figures uses; an unavailable answer is a failed read with Try again.
  const read = useRead<ReportFigures>(
    apiPath(["finance", "committees", reg, "report-figures"], { year }),
    { acceptData: (data) => data.state !== "unavailable" },
  );
  const data = read.data && String(read.data.year) === year ? read.data : null;
  const result = data ? accountFigures(data) : null;
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
          {kind
            ? `${kind} · Registration number ${reg}`
            : `Registration number ${reg}`}
        </span>
      </div>
      {!data && read.loading && <LoadingLine>Loading…</LoadingLine>}
      {/* The route answers every registration, so a 404 is a broken read, not "no report". */}
      {!data && (read.failed || read.notFound) && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {REPORT_LOAD_ERROR}
        </Refused>
      )}
      {result?.state === "none" && (
        <p className="cmm-line">No {year} report held</p>
      )}
      {result?.state === "figures" && (
        <>
          <dl className="cmm-figures">
            {result.figures.map((figure) => (
              <div key={figure.label} className="cmm-figure">
                <dt>{figure.label}</dt>
                <dd
                  className="cmm-value"
                  data-missing={figure.missing || undefined}
                >
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
          {result.report && <span className="cmm-report">{result.report}</span>}
        </>
      )}
    </div>
  );
}

/** The report totals' copy date for the Sources line, from the members' own
 * reads. Exported for the test; the page reads it through `copiedLine`. */
export function copiedLine(
  dates: Array<string | null | undefined>,
): string | null {
  const labels = [
    ...new Set(dates.filter(Boolean).map((date) => centralDateLabel(date!))),
  ];
  return labels.length > 0
    ? `report totals copied ${labels.join(" and ")}`
    : null;
}
