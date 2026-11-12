import { useEffect, useRef, type FormEvent } from "react";

import {
  COMMITTEE_PAGE_SIZE,
  kindFilterNoun,
  type CommitteeKindFilter,
} from "@alethical/shared/committeeList";
import {
  committeeEyebrow,
  formatDay,
} from "@alethical/shared/committeeMoneyShared";
import { centralDateLabel, formatCount } from "@alethical/shared/moneyLanding";
import { paymentCopyLines } from "@alethical/shared/paymentCopyDates";

import { useRead, type Read } from "../api/read";
import { Link, useLocation } from "../router";
import { useLiveSearch } from "../search/useLiveSearch";
import { withFrom } from "../returnContext";
import { hrefFor, isBuilt, type RouteMatch } from "../routes";
import { useAddressState } from "../ui/addressState";
import { useBand } from "../ui/band";
import {
  ClearAll,
  Dropdown,
  Empty,
  LoadingRows,
  Refused,
  Updating,
} from "../ui/controls";
import { RecordMark } from "../ui/marks";
import { ScrollingTabs } from "../ui/scrollingTabs";
import { Arrow, SourcesAndUpdates, type SourceGroup } from "../ui/parts";
import "./campaignMoney.css";

const BOARD = "Minnesota Campaign Finance and Public Disclosure Board";
/** The register endpoint refuses a longer name (q max_length 200). */
const MAX_QUERY = 200;

/** The 3 directory tabs, in the drawing's order, and the register kind each reads.
 * The register holds exactly these 3 kinds, so no finer tab exists (#1661). */
export type DirectoryTab = "candidates" | "committees" | "party";

const TABS: ReadonlyArray<{
  value: DirectoryTab;
  label: string;
  kind: CommitteeKindFilter;
}> = [
  {
    value: "candidates",
    label: "Candidate committees",
    kind: "candidate_committee",
  },
  {
    value: "committees",
    label: "Committees and funds",
    kind: "political_committee_or_fund",
  },
  { value: "party", label: "Party units", kind: "party_unit" },
];

export function tabFromParam(raw: string): DirectoryTab {
  return TABS.find((tab) => tab.value === raw)?.value ?? "candidates";
}

export function pageFromParam(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

/** One register row as `/campaign-finance/committees` serves it. */
export interface CommitteeRow {
  registration_number: string;
  name: string;
  kind: string | null;
  sub_type: string | null;
  office: string | null;
  district: string | null;
  is_closed: boolean | null;
  termination_date: string | null;
  registration_date?: string | null;
  registration_status?: "open" | "terminated" | "not_listed" | "unknown";
  party?: string | null;
  retained?: boolean;
  captured_at?: string | null;
}

export interface CommitteeRegister {
  state: "reported" | "unavailable" | string;
  /** The register kind these rows were read for, echoed by the server. */
  kind?: string | null;
  q?: string | null;
  status?: string | null;
  party?: string | null;
  candidate_parties?: string[] | null;
  committees: CommitteeRow[];
  page: {
    limit: number;
    offset: number;
    has_more: boolean;
    total: number | null;
  };
  register_total: number | null;
  by_kind: Partial<Record<string, number>> | null;
  held_by_kind?: Partial<Record<string, number>> | null;
  as_of: string | null;
  reason: string | null;
}

interface MoneySummary {
  freshness?: {
    payment_copied_at?: {
      contributions?: string | null;
      expenditures?: string | null;
      independent_expenditures?: string | null;
    } | null;
    register_fetched_at?: string | null;
  } | null;
}

/** The register read for one view: the server pages and searches, never the browser. */
export function registerPath(
  tab: DirectoryTab,
  query: string,
  page: number,
  sort = "name",
  status = "all",
  party = "",
): string {
  const kind =
    TABS.find((item) => item.value === tab)?.kind ?? "candidate_committee";
  const params = new URLSearchParams({
    kind,
    limit: String(COMMITTEE_PAGE_SIZE),
    offset: String((page - 1) * COMMITTEE_PAGE_SIZE),
  });
  if (query) params.set("q", query);
  if (sort === "registration") params.set("sort", sort);
  params.set(
    "status",
    status === "open" || status === "terminated" ? status : "all",
  );
  if (tab === "candidates" && party) params.set("party", party);
  return `finance/committees?${params.toString()}`;
}

/** "762 candidate committees": the served count for this tab and search. */
export function countLine(
  tab: DirectoryTab,
  total: number | null,
): string | null {
  if (total === null || total === undefined) return null;
  const kind =
    TABS.find((item) => item.value === tab)?.kind ?? "candidate_committee";
  return `${formatCount(total)} ${kindFilterNoun(kind, total)}`;
}

export function pageCount(total: number | null): number {
  return Math.max(1, Math.ceil((total ?? 0) / COMMITTEE_PAGE_SIZE));
}

/**
 * The bottom section's lines: the register's copy date, then the payment files'
 * and report totals' dates in the shared wording. The register and report totals
 * are copied together (the public money page's "Committee register and report totals last
 * copied"); a date the server did not serve is left out, never borrowed.
 */
export function sourceGroups(
  register: CommitteeRegister | null,
  summary: MoneySummary | null,
): SourceGroup[] {
  const fetched = summary?.freshness?.register_fetched_at;
  const registerDay = fetched
    ? centralDateLabel(fetched)
    : formatDay(register?.as_of ?? null);
  const items: string[] = [];
  if (registerDay) items.push(`Register copied ${registerDay}`);
  const copied = summary?.freshness?.payment_copied_at;
  if (copied) {
    items.push(
      ...paymentCopyLines(
        {
          contributions: copied.contributions ?? null,
          expenditures: copied.expenditures ?? null,
          independentExpenditures: copied.independent_expenditures ?? null,
        },
        registerDay,
      ),
    );
  }
  return items.length > 0
    ? [{ source: BOARD, items: punctuateGroup(items) }]
    : [];
}

/** The Other ways in cards (Campaign Money drawing, Round 29) whose pages exist,
 * worded and punctuated as 1 group. Donors by employer is entered from here, not
 * from Finance Home (eug-44). Payments under a name and Money by race open only
 * with a name or a contest, so neither has a plain entrance here. */
const SIDE_CARDS: ReadonlyArray<{
  route: "recipients" | "employers" | "money-by-race";
  params?: Record<string, string>;
  title: string;
  body: string;
}> = [
  {
    route: "recipients" as const,
    title: "Vendors and payees",
    body: "Find recipients named in payment records.",
  },
  {
    route: "employers" as const,
    title: "Donors by employer",
    body: "Find donors by the employer name reported in their filings.",
  },
  {
    // An office alone opens that office's first contest, as the drawing's
    // unparameterised link does.
    route: "money-by-race" as const,
    params: { id: "house" },
    title: "Money by race",
    body: "Candidate committees and outside spending for one office, district and year, kept distinct.",
  },
];

/** About these records: 1 group, 1 item has 3 sentences, so every item ends
 * with a period (eug-31). */
const ABOUT = [
  "Campaign payment records before 2015 are not included.",
  "These records cover campaign finances, not the wider finances of organizations with political committees or funds.",
  "Some donations are reported together without donor names as non-itemized contributions. This is allowed when a donor gives $200 or less to the same committee, party unit or fund in a calendar year. For ballot-question committees and funds, the limit is $500.",
];

/** Status belongs to this exact held registration; retention never proves termination. */
export function registrationStatus(
  row: Pick<CommitteeRow, "is_closed" | "termination_date"> &
    Partial<CommitteeRow>,
): {
  text: string;
  state: "open" | "terminated" | "retained" | "unknown";
} {
  if (row.retained || row.registration_status === "not_listed") {
    return {
      text: "No longer listed in the current register",
      state: "retained",
    };
  }
  const status =
    row.registration_status ??
    (row.is_closed === true
      ? "terminated"
      : row.is_closed === false
        ? "open"
        : "unknown");
  if (status === "terminated") {
    const day = formatDay(row.termination_date);
    return {
      text: day ? `Terminated ${day}` : "Terminated",
      state: "terminated",
    };
  }
  if (status === "open") {
    const day = formatDay(row.registration_date ?? null);
    return {
      text: day ? `Registered ${day}` : "Open registration",
      state: "open",
    };
  }
  return { text: "Registration status not held", state: "unknown" };
}

const REGISTRATIONS = [
  { value: "all", label: "All registrations" },
  { value: "open", label: "Open registrations" },
  { value: "terminated", label: "Terminated registrations" },
];

function registrationFilter(value: string | null | undefined) {
  return value === "open" || value === "terminated" ? value : "all";
}

/** The lines of 1 Sources and updates group, punctuated as 1 group (eug-31):
 * when any line has 2 or more sentences, every line ends with a period. */
export function punctuateGroup(items: string[]): string[] {
  const sentences = (line: string) => (line.match(/[.!?](\s|$)/g) ?? []).length;
  if (!items.some((line) => sentences(line) >= 2)) return items;
  return items.map((line) => (/[.!?]$/.test(line) ? line : `${line}.`));
}

const ADDRESS_DEFAULTS = {
  tab: "candidates",
  q: "",
  page: "1",
  sort: "name",
  reg: "all",
  party: "",
  view: "",
  reg_candidates: "",
  reg_committees: "",
  reg_party: "",
  sort_candidates: "",
  sort_committees: "",
  sort_party: "",
  spage_candidates: "1",
  spage_committees: "1",
  spage_party: "1",
  party_candidates: "",
};
type DirectoryAddress = typeof ADDRESS_DEFAULTS;
type GroupChoices = { reg: string; sort: string; party: string; page: string };
function validParty(value: string): string {
  return value.length <= 200 && !value.includes("\0") ? value : "";
}
const READ_OPTIONS = {
  keepPrevious: true,
  acceptData: (data: CommitteeRegister) => data.state === "reported",
};

function resultCount(read: Read<CommitteeRegister>): number | null {
  if (
    read.loading ||
    read.pending ||
    read.updating ||
    read.failed ||
    read.notFound
  )
    return null;
  return read.data?.page.total ?? null;
}

function searchChoices(
  address: DirectoryAddress,
  tab: DirectoryTab,
): GroupChoices {
  const browseTab = tabFromParam(address.tab);
  return {
    reg: registrationFilter(
      address[`reg_${tab}`] || (tab === browseTab ? address.reg : "all"),
    ),
    sort:
      (address[`sort_${tab}`] ||
        (tab === browseTab ? address.sort : "name")) === "registration"
        ? "registration"
        : "name",
    party:
      tab === "candidates"
        ? address.party_candidates === "all"
          ? ""
          : validParty(address.party_candidates || address.party)
        : "",
    page: address[`spage_${tab}`],
  };
}

/** Reads stay mounted by category, so one failure cannot replace another group's result. */
export function CampaignMoney(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [address, setAddress] = useAddressState(ADDRESS_DEFAULTS);
  const tab = tabFromParam(address.tab);
  const submitted = address.q.trim().slice(0, MAX_QUERY).trimEnd();
  const full =
    submitted && TABS.some((item) => item.value === address.view)
      ? (address.view as DirectoryTab)
      : null;
  const browseChoices = {
    reg: registrationFilter(address.reg),
    sort: address.sort === "registration" ? "registration" : "name",
    party: tab === "candidates" ? validParty(address.party) : "",
    page: address.page,
  };
  const choices = {
    candidates: searchChoices(address, "candidates"),
    committees: searchChoices(address, "committees"),
    party: searchChoices(address, "party"),
  };
  function pathFor(group: DirectoryTab) {
    const choice = choices[group];
    return submitted
      ? registerPath(
          group,
          submitted,
          full === group ? pageFromParam(choice.page) : 1,
          choice.sort,
          choice.reg,
          choice.party,
        )
      : null;
  }
  const browse = useRead<CommitteeRegister>(
    submitted
      ? null
      : registerPath(
          tab,
          "",
          pageFromParam(address.page),
          browseChoices.sort,
          browseChoices.reg,
          browseChoices.party,
        ),
    READ_OPTIONS,
  );
  const candidates = useRead<CommitteeRegister>(
    pathFor("candidates"),
    READ_OPTIONS,
  );
  const committees = useRead<CommitteeRegister>(
    pathFor("committees"),
    READ_OPTIONS,
  );
  const party = useRead<CommitteeRegister>(pathFor("party"), READ_OPTIONS);
  const searchReads = { candidates, committees, party };
  const summary = useRead<MoneySummary>("campaign-finance/summary");
  const phone = useBand() === "phone";
  const [typed, setTyped, applySearch] = useLiveSearch(
    submitted,
    here,
    (q) => {
      setAddress(
        {
          q,
          view: q ? address.view : "",
          spage_candidates: "1",
          spage_committees: "1",
          spage_party: "1",
        },
        { replace: Boolean(q) === Boolean(submitted) },
      );
    },
    (value) => value.trim().slice(0, MAX_QUERY).trimEnd(),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applySearch();
  }
  const allEmpty = TABS.every(({ value }) => {
    const read = searchReads[value],
      choice = choices[value];
    return resultCount(read) === 0 && choice.reg === "all" && !choice.party;
  });
  const groups = sourceGroups(
    submitted
      ? (candidates.data ?? committees.data ?? party.data)
      : browse.data,
    summary.data,
  );
  const cards = SIDE_CARDS.filter((card) => isBuilt(card.route));
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef({ submitted, full });
  useEffect(() => {
    const previous = previousView.current;
    previousView.current = { submitted, full };
    if (previous.submitted && !submitted) searchInput.current?.focus();
    else if (submitted && previous.full !== full)
      resultsHeading.current?.focus();
  }, [submitted, full]);
  function showFull(view: DirectoryTab | "") {
    setAddress({ view }, { replace: false });
  }
  function viewHref(view: DirectoryTab | "") {
    const params = new URLSearchParams(location.search);
    if (view) params.set("view", view);
    else params.delete("view");
    return `${location.pathname}?${params}`;
  }
  const tabs = TABS.map((item) => {
    const read = searchReads[item.value];
    const current =
      new URLSearchParams(read.dataPath?.split("?")[1]).get("q") === submitted;
    const count = submitted
      ? current
        ? resultCount(read)
        : null
      : browse.data?.held_by_kind?.[item.kind];
    return {
      value: item.value,
      label: item.label,
      count: typeof count === "number" ? formatCount(count) : null,
    };
  });
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        <header className="cm-header">
          <div className="cm-intro">
            <h1 tabIndex={-1} className="f-page-title">
              Campaign money
            </h1>
            <p className="cm-dek">
              Candidate committees, committees and funds, and party units
              registered in Minnesota, with their official report figures and
              itemized payments
            </p>
          </div>
          {isBuilt("money-connections") && (
            <Link
              to={withFrom(hrefFor("money-connections"), here)}
              className="f-btn f-action cm-connections"
            >
              <span>Explore money connections</span>
              <Arrow stroke="#FFFFFF" />
            </Link>
          )}
        </header>

        <form role="search" onSubmit={submit} className="cm-search">
          {/* The drawn label shows on phone, above the field; elsewhere the field's
              hint says it (settled wording row 3). */}
          <label
            htmlFor="money-name"
            className={phone ? "cm-search-label" : "f-visually-hidden"}
          >
            Search by name or registration number
          </label>
          <input
            ref={searchInput}
            id="money-name"
            type="search"
            className="f-field cm-field"
            value={typed}
            maxLength={MAX_QUERY}
            autoComplete="off"
            placeholder={
              phone
                ? "Name or registration number"
                : "Search by name or registration number"
            }
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" className="f-btn cm-submit">
            Search
          </button>
        </form>

        {submitted && isBuilt("payments-under-name") && (
          <section aria-label="Name search" className="cm-name-search">
            <p>Payments recorded under that spelling are a separate search</p>
            <Link
              to={withFrom(
                hrefFor("payments-under-name", { query: submitted }),
                here,
              )}
              className="cm-card cm-payments"
            >
              <span className="cm-payments-text">
                <span className="cm-card-title">Payments under a name</span>
                <span className="cm-payments-note">
                  Every campaign and outside-spending payment, grouped by exact
                  spelling
                </span>
              </span>
              <Arrow />
            </Link>
          </section>
        )}

        <div className="cm-layout">
          <div className="cm-directory">
            {submitted && (
              <div className="cm-search-heading">
                {full && (
                  <Link to={viewHref("")} className="cm-view-all cm-back">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M15 6 L9 12 L15 18"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Back to all results
                  </Link>
                )}
                <div className="cm-search-title">
                  <h2 ref={resultsHeading} tabIndex={-1}>
                    Results for “{submitted}”
                  </h2>
                  <button
                    type="button"
                    className="f-btn f-btn-secondary"
                    onClick={() => applySearch("")}
                  >
                    Clear search
                  </button>
                </div>
              </div>
            )}
            {(!submitted || full) && (
              <div className="cm-tabs">
                <ScrollingTabs
                  label={submitted ? "Result groups" : "Directory"}
                  value={full ?? tab}
                  tabs={tabs}
                  onChange={(next) =>
                    submitted
                      ? showFull(tabFromParam(next))
                      : setAddress({ tab: next, party: "", page: "1" })
                  }
                />
              </div>
            )}
            {submitted && !full && allEmpty ? (
              <Empty
                title={`No matches for “${submitted}”`}
                next="Try a full or partial name or registration number"
              />
            ) : submitted ? (
              <div className="cm-search-groups">
                {TABS.filter((item) => !full || item.value === full).map(
                  (item) => (
                    <RegisterGroup
                      key={item.value}
                      tab={item.value}
                      read={searchReads[item.value]}
                      here={here}
                      choices={choices[item.value]}
                      preview={!full}
                      viewAllHref={viewHref(item.value)}
                      setAddress={(change) => {
                        const updates: Partial<DirectoryAddress> = {};
                        if (change.reg !== undefined)
                          updates[`reg_${item.value}`] = change.reg;
                        if (change.sort !== undefined)
                          updates[`sort_${item.value}`] = change.sort;
                        if (
                          change.party !== undefined &&
                          item.value === "candidates"
                        )
                          updates.party_candidates = change.party || "all";
                        if (change.page !== undefined)
                          updates[`spage_${item.value}`] = change.page;
                        setAddress(updates);
                      }}
                    />
                  ),
                )}
              </div>
            ) : (
              <RegisterGroup
                tab={tab}
                read={browse}
                here={here}
                choices={browseChoices}
                setAddress={setAddress}
              />
            )}
          </div>
          <aside aria-label="Other ways in" className="cm-aside">
            {cards.map((card) => (
              <Link
                key={card.route}
                to={withFrom(hrefFor(card.route, card.params), here)}
                className="cm-card cm-side-card"
              >
                <span className="cm-side-head">
                  <span className="cm-card-title">{card.title}</span>
                  <Arrow />
                </span>
                <span className="cm-side-body">{card.body}</span>
              </Link>
            ))}
          </aside>
        </div>
        <section aria-labelledby="cm-about" className="cm-about">
          <h2 id="cm-about">About these records</h2>
          <ul>
            {ABOUT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>
      <SourcesAndUpdates groups={groups} />
    </main>
  );
}

function RegisterGroup({
  tab,
  read,
  here,
  choices,
  preview = false,
  viewAllHref,
  setAddress,
}: {
  tab: DirectoryTab;
  read: Read<CommitteeRegister>;
  here: string;
  choices: GroupChoices;
  preview?: boolean;
  viewAllHref?: string;
  setAddress: (change: Partial<GroupChoices>) => void;
}) {
  const { reg, sort, party } = choices;
  const page = pageFromParam(choices.page);
  const register = read.data;
  const rows = register?.committees ?? [];
  const total = register?.page.total ?? null;
  const pages = pageCount(total);
  const shownPage = register
    ? Math.floor(register.page.offset / COMMITTEE_PAGE_SIZE) + 1
    : page;
  const pagingUnavailable =
    read.pending || read.updating || read.failed || read.notFound;
  useEffect(() => {
    const own = register?.page.offset === (page - 1) * COMMITTEE_PAGE_SIZE;
    if (
      !preview &&
      own &&
      !read.updating &&
      !read.failed &&
      total !== null &&
      page > pages
    )
      setAddress({ page: String(pages) });
  }, [
    preview,
    register,
    read.updating,
    read.failed,
    total,
    page,
    pages,
    setAddress,
  ]);
  const list = useRef<HTMLDivElement>(null);
  function goPage(next: number) {
    if (pagingUnavailable) return;
    setAddress({ page: String(next) });
    if (list.current) {
      window.scrollTo({
        top: Math.max(
          0,
          list.current.getBoundingClientRect().top + window.scrollY - 20,
        ),
        behavior: "smooth",
      });
      list.current.focus({ preventScroll: true });
    }
  }
  const freshFailure = (read.failed || read.notFound) && !register;
  const retainedFailure = (read.failed || read.notFound) && !!register;
  const showList = register !== null;
  const shownParams = new URLSearchParams(read.dataPath?.split("?")[1]);
  const shownQuery = shownParams.get("q") ?? "";
  const shownTab =
    TABS.find((item) => item.kind === register?.kind)?.value ?? tab;
  const count = countLine(shownTab, total);
  const previousScope = [
    TABS.find((item) => item.value === shownTab)?.label,
    REGISTRATIONS.find(
      (item) => item.value === registrationFilter(shownParams.get("status")),
    )?.label,
    shownParams.get("party"),
    shownQuery ? `Matching “${shownQuery}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const partyOptions = [
    ...new Set([
      ...(register?.candidate_parties ?? []),
      ...(party ? [party] : []),
    ]),
  ];
  const label = TABS.find((item) => item.value === tab)!.label;
  const currentCount = resultCount(read);
  return (
    <section aria-label={label} className="cm-group">
      {preview && (
        <h3>
          {label}
          {currentCount !== null ? ` (${formatCount(currentCount)})` : ""}
        </h3>
      )}
      {(rows.length > 0 || reg !== "all" || party) && (
        <div className="cm-filters">
          {tab === "candidates" && partyOptions.length > 0 && (
            <Dropdown
              name="Party"
              value={party}
              options={[
                { value: "", label: "All parties" },
                ...partyOptions.map((value) => ({ value, label: value })),
              ]}
              onChange={(party) => setAddress({ party, page: "1" })}
            />
          )}
          <Dropdown
            name="Registration"
            value={reg}
            options={REGISTRATIONS}
            onChange={(reg) => setAddress({ reg, page: "1" })}
          />
          {rows.length > 0 && (
            <Dropdown
              name="Sort by"
              value={sort}
              options={[
                { value: "name", label: "Name A–Z" },
                { value: "registration", label: "Registration number" },
              ]}
              onChange={(sort) => setAddress({ sort, page: "1" })}
            />
          )}
          {(sort === "registration" || reg !== "all" || party) && (
            <ClearAll
              onClick={() =>
                setAddress({
                  sort: "name",
                  reg: "all",
                  party: "",
                  page: "1",
                })
              }
            />
          )}
        </div>
      )}
      <div ref={list} tabIndex={-1} className="cm-list">
        {read.loading && <LoadingRows />}
        {freshFailure && (
          <Refused onRetry={read.retry} retrying={read.pending}>
            Couldn’t load results. This is a problem on our side and says
            nothing about who is registered.
          </Refused>
        )}
        {showList && (
          <>
            {read.updating && (
              <div className="cm-notice">
                <Updating />
              </div>
            )}
            {retainedFailure && (
              <div className="cm-notice">
                <Refused onRetry={read.retry} retrying={read.pending}>
                  Couldn’t update results. Previous results are shown.
                </Refused>
              </div>
            )}
            {(read.updating || retainedFailure) && (
              <p className="cm-notice" role="status">
                Previous results: {previousScope}
              </p>
            )}
            {!preview && (
              <div aria-live="polite" className="f-count-line cm-count">
                {count}
              </div>
            )}
            {rows.length === 0 ? (
              <p role="status" className="cm-empty">
                No matches
              </p>
            ) : (
              <>
                <div role="table" aria-label={label} className="cm-table">
                  <div role="row" className="cm-row cm-head">
                    <span role="columnheader">NAME</span>
                    <span role="columnheader">TYPE</span>
                    <span role="columnheader" className="cm-reg">
                      REGISTRATION NUMBER
                    </span>
                    <span role="columnheader">REGISTRATION STATUS</span>
                  </div>
                  {(preview ? rows.slice(0, 5) : rows).map((row) => {
                    const status = registrationStatus(row);
                    return (
                      <div
                        role="row"
                        key={row.registration_number}
                        className="cm-row"
                      >
                        <span role="cell" className="cm-name f-marked">
                          <RecordMark kind="committee" />
                          {isBuilt("committee") ? (
                            <Link
                              to={withFrom(
                                hrefFor("committee", {
                                  id: row.registration_number,
                                }),
                                here,
                              )}
                              className="cm-name-link"
                            >
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          )}
                        </span>
                        <span role="cell" className="cm-kind">
                          {[
                            committeeEyebrow(row.kind, row.sub_type),
                            shownTab === "candidates" ? row.party : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span role="cell" className="cm-reg f-num">
                          <span className="cm-reg-word">
                            Registration number{" "}
                          </span>
                          {row.registration_number}
                        </span>
                        <span
                          role="cell"
                          className="cm-status f-num"
                          data-status={status.state}
                        >
                          {status.text}
                          {(row.retained ||
                            row.registration_status === "not_listed") &&
                            row.captured_at && (
                              <span className="cm-status-copy">
                                Last listed in the register copied{" "}
                                {centralDateLabel(row.captured_at)}
                              </span>
                            )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {preview &&
                  (total === null
                    ? rows.length > 5 || register?.page.has_more
                    : total > 5) && (
                    <Link to={viewAllHref!} className="cm-view-all">
                      View all matching{" "}
                      {TABS.find(
                        (item) => item.value === tab,
                      )?.label.toLowerCase()}
                      <Arrow />
                    </Link>
                  )}
                {!preview && pages > 1 && (
                  <nav aria-label="Pages" className="cm-pager">
                    <button
                      type="button"
                      className="f-btn f-btn-secondary cm-page-btn"
                      aria-disabled={
                        pagingUnavailable || shownPage <= 1 || undefined
                      }
                      onClick={() => shownPage > 1 && goPage(shownPage - 1)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M15 5 L8 12 L15 19"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Previous
                    </button>
                    <span aria-live="polite" className="cm-page-line f-num">
                      Page {formatCount(Math.min(shownPage, pages))} of{" "}
                      {formatCount(pages)}
                    </span>
                    <button
                      type="button"
                      className="f-btn f-btn-secondary cm-page-btn"
                      aria-disabled={
                        pagingUnavailable || shownPage >= pages || undefined
                      }
                      onClick={() => shownPage < pages && goPage(shownPage + 1)}
                    >
                      Next
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M9 5 L16 12 L9 19"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
