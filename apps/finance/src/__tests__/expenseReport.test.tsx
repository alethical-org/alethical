import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearReadCache } from "../api/read";
import { navigate } from "../router";
import { ExpenseReport } from "../pages/elections/ExpenseReport";
import * as d from "../pages/elections/expenseReportData";
import { authorityGroups } from "../pages/elections/expenseExternal";
import { reportedMoneyLabel } from "../pages/elections/format";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../auth/session", () => ({
  useFinanceSession: () => ({
    apiBaseUrl: "https://api.example.test",
    accessToken: "private-token",
    status: "granted",
    revoked: false,
    email: "reader@example.test",
    retry: vi.fn(),
  }),
}));
const election = "mn-2026-11-03-general";
const snapshot = "a".repeat(64),
  collection = "b".repeat(64),
  latest = "c".repeat(64),
  old = "d".repeat(64),
  second = "e".repeat(64),
  payeeId = "f".repeat(64);
const rootPath = `/money/races?report=expenses&election=${election}&q=old-race-search&page=3`;
const money = (
  total: string,
  paid = total,
  unpaid = "0.00",
  in_kind = "0.00",
): d.Amounts => ({
  total,
  paid,
  unpaid,
  in_kind,
});
const claim = (name: string, party: d.Party, id: string): d.Claim => ({
  name,
  party_group: party,
  filed_party: party,
  race_id: "race-1",
  candidate_id: id,
});
const dana = claim("Example Dana", "DFL", "dana"),
  robin = claim("Example Robin", "R", "robin"),
  pat = claim("Example Pat", "NP", "pat");
const identity: d.PayeeIdentity = {
  name: "Exact Printer LLC",
  address: {
    street: null,
    city: "St. Paul",
    state: "MN",
    postal_code: "55101",
  },
  source: [],
};
const filing: d.Filing = {
  filing_year: 2026,
  report_type: "pre_general",
  report_name: "Pre-general report",
  cut_off_date: "2026-10-19",
  special_election: false,
  effective_amendment_index: 1,
  amendment_count: 2,
};
const account = (
  key: string,
  reg: string,
  claims: d.Claim[],
  total: string,
): d.AccountReport => ({
  report_key: key,
  registration_number: reg,
  claims,
  display_claims: claims,
  party_group: claims.length > 1 ? "unknown" : claims[0].party_group,
  party_classification_state:
    claims.length > 1 ? "mixed_ballot_parties" : "single_ballot_party",
  filing,
  period_start: "2026-01-01",
  period_end: "2026-10-19",
  source: {
    sha256: "1".repeat(64),
    retained_source_url: "unused-official-url",
    document: {
      sha256: "1".repeat(64),
      file: "Exact retained report.pdf",
      fetched_at: "2026-11-11T14:00:00Z",
    },
  },
  figure_status: "checked",
  campaign_expenses: money(total),
  expense_source: { page: 2, summary_lines: [11] },
  public_subsidy: {
    cash: "20.25",
    total: "20.25",
    source_page: 2,
    source_lines: [7],
  },
  public_subsidy_gap: null,
  detail_status: "checked",
  detail_gap: null,
  itemized_totals: money(total),
  non_itemized_totals: money("0.00"),
  checked_detail_before_exclusions: money(total),
  checked_detail_after_exclusions: money(total),
  detail_gaps: [],
});
const candidate = (
  entry: d.Claim,
  report: string,
  reg: string,
): d.Candidate => ({
  ...entry,
  office: "State Representative",
  district: "1A",
  jurisdiction: "Minnesota",
  candidate_source_sha256: "2".repeat(64),
  party_sources: [
    {
      kind: "official_result",
      source_sha256: "2".repeat(64),
      row_number: 27,
      candidate_id: entry.candidate_id,
      party_value: entry.filed_party!,
      availability: "available",
    },
  ],
  filing_authority: "mn_cfb",
  confirmed_account_count: 1,
  accounts: [
    {
      registration_number: reg,
      report_key: report,
      committee_name: "As filed campaign",
      account_filed_party: entry.filed_party,
      checked_on: "2026-11-12",
    },
  ],
  gaps: [],
});
function fixture(): d.ExpenseAnswer {
  const accounts = [
    account(latest, "12345", [dana, robin], "100.50"),
    account(second, "67890", [pat], "50.75"),
  ];
  const detail: d.DetailTotals = {
    available_account_reports: 2,
    amounts: money("151.25"),
    payment_count: 2,
    by_party: Object.fromEntries(
      ["R", "DFL", "NP", "other", "unknown"].map((party) => [
        party,
        {
          available_account_reports:
            party === "unknown" || party === "NP" ? 1 : 0,
          amounts:
            party === "unknown"
              ? money("100.50")
              : party === "NP"
                ? money("50.75")
                : null,
        },
      ]),
    ) as d.DetailTotals["by_party"],
    by_filed_address: {
      MN: money("151.25"),
      out_of_state: money("0.00"),
      unknown: money("0.00"),
    },
  };
  return {
    schema_version: 1,
    election_key: election,
    election_date: "2026-11-03",
    snapshot_id: snapshot,
    collection_id: collection,
    version: "1".repeat(16),
    copied_at: "2026-11-12",
    reporting_scope: "latest_effective_reports",
    filters: {},
    coverage: {
      named_candidacies: 8002,
      scoped_candidacies: 3,
      scoped_candidacies_with_confirmed_accounts: 3,
      selected_account_reports: 2,
      checked_detail_account_reports: 2,
    },
    summary: {
      candidacy_counts_by_ballot_party: {
        R: 1,
        DFL: 1,
        NP: 1,
        other: 0,
        unknown: 0,
      },
      source_report_totals: { available_accounts: 2, amounts: money("151.25") },
      public_subsidy_receipts: { available_accounts: 2, amount: "40.50" },
      baseline_checked_itemized_detail: structuredClone(detail),
      adjusted_checked_itemized_detail: structuredClone(detail),
      visible_checked_itemized_detail: structuredClone(detail),
      non_itemized_on_checked_detail_reports: money("0.00"),
      withheld_detail_accounts: 0,
      periods: accounts.map((a) => ({
        registration_number: a.registration_number,
        report_key: a.report_key,
        start: a.period_start,
        end: a.period_end,
      })),
    },
    candidates: [
      candidate(dana, latest, "12345"),
      candidate(pat, second, "67890"),
      candidate(robin, latest, "12345"),
    ],
    account_reports: accounts,
    excluded_payees: [],
    report_options: accounts.map((a) => ({
      registration_number: a.registration_number,
      reports: [
        {
          report_key: a.report_key,
          collection_id: collection,
          filing: a.filing,
          period_start: a.period_start,
          period_end: a.period_end,
          period_basis: "report",
          document_hash: a.source.sha256,
          selected: true,
          source_state: "available",
        },
        ...(a.report_key === latest
          ? [
              {
                report_key: old,
                collection_id: collection,
                filing: {
                  ...a.filing,
                  report_type: "pre_primary",
                  report_name: "Pre-primary report",
                  cut_off_date: "2026-07-22",
                },
                period_start: "2026-01-01",
                period_end: "2026-07-22",
                period_basis: "report",
                document_hash: "3".repeat(64),
                selected: false,
                source_state: "not_checked" as const,
              },
            ]
          : []),
      ],
    })),
    page: { limit: 50, offset: 0, total: 3 },
  };
}
const payee = (): d.Payee => ({
  payee_id: payeeId,
  payee: identity,
  geography: "MN",
  excludable: true,
  report_keys: [latest],
  purposes: ["Printing as filed"],
  source: [
    {
      source_sha256: "1".repeat(64),
      page: 4,
      line: 22,
      text: "Printing as filed 25.75",
    },
  ],
  payment_count: 1,
  amounts: money("25.75"),
});
const payment = (): d.Payment => ({
  record_id: "source-row-22",
  registration_number: "12345",
  report_key: latest,
  claims: [dana, robin],
  party_group: "unknown",
  period_start: "2026-01-01",
  period_end: "2026-10-19",
  payee_id: payeeId,
  payee: identity,
  underlying_vendor: { ...identity, name: "Underlying vendor as filed" },
  relationship: "reimbursement",
  geography: "MN",
  date: null,
  raw_date: null,
  purpose: "Printing as filed",
  amounts: money("25.75", "20.00", "5.75"),
  source: payee().source,
  payee_header_source: null,
  uncertainties: [],
});
let container: HTMLDivElement,
  root: Root,
  data: d.ExpenseAnswer,
  requests: URL[],
  handler: ((url: URL) => Promise<Response> | Response | undefined) | null;
const json = (answer: unknown) =>
  new Response(JSON.stringify({ data: answer }), {
    headers: { "Content-Type": "application/json" },
  });
async function settle() {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
}
const buttons = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.includes(text),
  );
async function click(button: HTMLElement) {
  await act(async () => button.click());
  await settle();
}
async function render(search = "") {
  window.history.replaceState(null, "", rootPath + search);
  await act(async () =>
    root.render(
      <ExpenseReport
        electionKey={election}
        backHref="/money/races?q=old-race-search&page=3"
      />,
    ),
  );
  await settle();
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  clearReadCache();
  data = fixture();
  requests = [];
  handler = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:report");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      expect(options.headers).toEqual({
        Authorization: "Bearer private-token",
      });
      const url = new URL(input);
      requests.push(url);
      const special = handler?.(url);
      if (special) return special;
      if (url.pathname.includes("/finance/sources/"))
        return new Response("original", {
          headers: { "Content-Type": "application/pdf" },
        });
      const answer = structuredClone(data);
      const q = url.searchParams.get("candidate_query") || "";
      answer.filters = {
        candidate_query: q,
        payee_query: url.searchParams.get("payee_query") || "",
        report_keys: url.searchParams.getAll("report_keys"),
        excluded_payee_ids: url.searchParams.getAll("excluded_payee_ids"),
      };
      if (q || url.searchParams.has("candidate_id")) {
        answer.version = "2".repeat(16);
        answer.candidates = answer.candidates!.filter(
          (c) =>
            c.name.toLowerCase().includes(q.toLowerCase()) &&
            (!url.searchParams.has("candidate_id") ||
              c.candidate_id === url.searchParams.get("candidate_id")),
        );
        answer.page.total = answer.candidates.length;
      }
      if (url.searchParams.has("excluded_payee_ids")) {
        answer.account_reports[0].checked_detail_after_exclusions =
          money("74.75");
        answer.summary.adjusted_checked_itemized_detail.amounts =
          money("125.50");
        answer.summary.adjusted_checked_itemized_detail.by_filed_address.MN =
          money("125.50");
        answer.excluded_payees = [
          {
            payee_id: payeeId,
            payee: identity,
            geography: "MN",
            payment_count: 1,
            amounts: money("25.75"),
            account_reports: [
              {
                registration_number: "12345",
                report_key: latest,
                claims: [dana, robin],
                party_group: "unknown",
                period_start: "2026-01-01",
                period_end: "2026-10-19",
                payment_count: 1,
                amounts: money("25.75"),
              },
            ],
          },
        ];
      }
      if (url.pathname.endsWith("/payees")) {
        answer.payees = [payee()];
        answer.page.total = 1;
        delete answer.candidates;
      }
      if (url.pathname.endsWith("/payments")) {
        answer.payments = [payment()];
        answer.page.total = 1;
        delete answer.candidates;
      }
      return json(answer);
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearReadCache();
});

it("keeps literal parties, shared-account money once, full denominator and truncated display", async () => {
  await render();
  expect(container.textContent).toContain("Nonpartisan");
  expect(container.textContent).toContain(
    "8,002 candidates in the election record",
  );
  const mixed = [...container.querySelectorAll("tr")].find((row) =>
    row.textContent?.includes("Party cannot be assigned"),
  )!;
  expect(mixed.querySelector('[aria-label="Not applicable"]')).not.toBeNull();
  expect(container.querySelectorAll(".ex-account-title")).toHaveLength(2);
  expect(container.textContent).not.toContain("$100.50");
  expect(container.textContent).toContain(
    "Shared account, different ballot parties",
  );
  expect(requests).toHaveLength(1);
});

it("keeps unavailable, checked sub-dollar zero, non-itemized and reconciliation gaps distinct", async () => {
  data.account_reports[0].public_subsidy = null;
  data.account_reports[0].detail_status = "unavailable";
  data.account_reports[0].detail_gap = "expense_detail_unreconciled";
  data.account_reports[0].checked_detail_after_exclusions = null;
  data.account_reports[1].public_subsidy!.total = "0.99";
  data.summary.withheld_detail_accounts = 1;
  await render();
  expect(container.textContent).toContain("Amounts do not match");
  expect(container.textContent).toContain("Itemized total · Unavailable");
  expect(container.textContent).toContain("Non-itemized spending");
  expect(container.querySelectorAll(".ex-account")[0].textContent).toContain(
    "Unavailable",
  );
  expect(
    container.querySelectorAll(".ex-account-title")[1].parentElement
      ?.textContent,
  ).toContain("$0");
  expect(container.textContent).not.toContain("$0 only");
});

it("top search makes two independent name searches and leaves summary scope unchanged", async () => {
  await render("&expenseQuery=Robin");
  const candidateRequest = requests.find(
    (url) => url.searchParams.get("candidate_query") === "Robin",
  )!;
  const payeeRequest = requests.find((url) =>
    url.pathname.endsWith("/payees"),
  )!;
  expect(candidateRequest.searchParams.has("payee_query")).toBe(false);
  expect(candidateRequest.searchParams.has("version")).toBe(false);
  expect(payeeRequest.searchParams.get("payee_query")).toBe("Robin");
  expect(payeeRequest.searchParams.has("candidate_query")).toBe(false);
  expect(payeeRequest.searchParams.get("version")).toBe("1".repeat(16));
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Candidates (1)",
  );
  const table = container.querySelector(".ex-party")!;
  expect(table.textContent).toContain("$151");
  expect(table.textContent).toContain("Nonpartisan");
  expect(container.querySelector(".ex-candidate")?.textContent).toContain(
    "Example Dana (Democratic)",
  );
});

it("scoped expansion keeps nonmatching shared members and its own pin", async () => {
  await render("&expenseQuery=Robin");
  await click(buttons("View payees")[0]);
  const scoped = requests.filter(
    (url) => url.searchParams.get("candidate_id") === "robin",
  );
  expect(scoped.length).toBeGreaterThan(1);
  const detail = scoped.find((url) => url.pathname.endsWith("/payees"))!;
  expect(detail.searchParams.get("version")).toBe("2".repeat(16));
  expect(detail.searchParams.get("race_id")).toBe("race-1");
  expect(container.textContent).toContain("Street address not shown");
  expect(container.textContent).toContain("St. Paul MN 55101");
  await click(buttons("View payments")[0]);
  expect(container.textContent).toContain("Underlying vendor as filed");
  expect(container.textContent).toContain("Date not shown");
  expect(
    requests.filter((url) => url.pathname.endsWith("/payments")),
  ).toHaveLength(1);
});

it("opens unnamed payments for their exact report without inventing a payee identity", async () => {
  handler = (url) => {
    if (!url.pathname.endsWith("/payees")) return undefined;
    const answer = structuredClone(data);
    answer.payees = [
      {
        ...payee(),
        payee_id: null,
        excludable: false,
        payee: { ...identity, name: null },
        report_keys: [latest],
      },
    ];
    answer.page.total = 1;
    return json(answer);
  };
  await render();
  await click(buttons("View payees")[0]);
  const control = buttons("View payments")[0];
  expect(control.disabled).toBe(false);
  await click(control);
  const request = requests.find((url) => url.pathname.endsWith("/payments"))!;
  expect(request.searchParams.get("unnamed_report_key")).toBe(latest);
  expect(request.searchParams.has("payee_id")).toBe(false);
  expect(request.searchParams.get("version")).toBe(data.version);
});

it("applies exact exclusions globally, keeps subsidy and baseline, and clears without a new identity", async () => {
  await render();
  await click(buttons("Exclude selected payees")[0]);
  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  await click(checkbox);
  await click(buttons("Apply exclusions")[0]);
  expect(
    new URL(window.location.href).searchParams.get("expenseExcluded"),
  ).toBe(payeeId);
  expect(container.querySelector(".ex-excluded")?.textContent).toContain(
    "Exact Printer LLC",
  );
  expect(container.querySelector(".ex-excluded")?.textContent).toContain(
    "Example Dana / Example Robin",
  );
  expect(container.querySelector(".ex-party")?.textContent).toContain("$151");
  expect(container.querySelector(".ex-party")?.textContent).toContain("$125");
  expect(container.querySelector(".ex-party")?.textContent).toContain("$40");
  await click(buttons("Clear exclusions")[0]);
  expect(
    new URL(window.location.href).searchParams.has("expenseExcluded"),
  ).toBe(false);
  expect(container.textContent).toContain("No exclusions applied");
});

it("restores selected exclusion names from the full response without loading every page", async () => {
  await render(`&expenseExcluded=${payeeId}`);
  expect(container.querySelector(".ex-excluded")?.textContent).toContain(
    "Exact Printer LLC",
  );
  expect(requests).toHaveLength(1);
});

it("closes exclusions on Escape without applying and restores focus", async () => {
  await render();
  const trigger = buttons("Exclude selected payees")[0];
  await click(trigger);
  await click(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
  );
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(container.querySelector(".ex-exclusion-panel")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(window.location.search).not.toContain("expenseExcluded");
  await click(trigger);
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .checked,
  ).toBe(false);
});

it("selects only held report keys and clears exclusions on period change", async () => {
  await render(`&expenseExcluded=${payeeId}`);
  await click(buttons("Latest available reports")[0]);
  await click(buttons("Pre-primary report")[0]);
  const url = new URL(window.location.href);
  expect(url.searchParams.get("expenseReports")).toBe(old);
  expect(url.searchParams.has("expenseExcluded")).toBe(false);
  expect(requests.at(-1)?.searchParams.getAll("report_keys")).toEqual([old]);
  expect(url.searchParams.get("q")).toBe("old-race-search");
  expect(url.searchParams.get("page")).toBe("3");
});

it("blocks malformed linked queries and selections before API work", async () => {
  await render("&expenseReports=wrong&expenseQuery=" + "x".repeat(201));
  expect(requests).toHaveLength(0);
  expect(container.textContent).toContain("invalid search or selection");
  await click(buttons("Clear filters")[0]);
  expect(requests).toHaveLength(1);
});

it("retains old-scope rows on failed search, with retry and no replacement zero", async () => {
  await render("&expenseQuery=Dana");
  handler = (url) =>
    url.searchParams.get("candidate_query") === "Robin"
      ? new Response("", { status: 503 })
      : undefined;
  await act(async () =>
    navigate(rootPath + "&expenseQuery=Robin", { replace: true }),
  );
  await settle();
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Example Dana",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Showing previous report scope",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Candidates matching “Dana”",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Couldn’t update results",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).not.toContain(
    "No matching candidates",
  );
});

it("ignores a late candidate search reply after a newer query", async () => {
  let finish: ((response: Response) => void) | undefined;
  handler = (url) =>
    url.searchParams.get("candidate_query") === "Dana"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : undefined;
  await render("&expenseQuery=Dana");
  await act(async () =>
    navigate(rootPath + "&expenseQuery=Robin", { replace: true }),
  );
  await settle();
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Example Robin",
  );
  await act(async () =>
    finish!(
      json({ ...fixture(), candidates: [candidate(dana, latest, "12345")] }),
    ),
  );
  await settle();
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Example Robin",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).not.toContain(
    "Candidates (3)",
  );
});

it("uses current exact pins for CSV, keeps decimals in bytes and has no JSON control", async () => {
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  handler = (url) =>
    url.pathname.endsWith("/export")
      ? new Response("Row type,Payment total\nPayment,25.75\n", {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition":
              'attachment; filename="campaign-expenses-2026.csv"',
          },
        })
      : undefined;
  await render(`&expenseReports=${old}&expenseExcluded=${payeeId}`);
  await click(buttons("Download CSV")[0]);
  const request = requests.find((url) => url.pathname.endsWith("/export"))!;
  expect(request.searchParams.get("snapshot_id")).toBe(snapshot);
  expect(request.searchParams.get("version")).toBe("1".repeat(16));
  expect(request.searchParams.getAll("report_keys")).toEqual([old]);
  expect(request.searchParams.getAll("excluded_payee_ids")).toEqual([payeeId]);
  expect(clicked[0].download).toBe("campaign-expenses-2026.csv");
  expect(container.textContent).toContain("Download started");
  expect(container.textContent).not.toContain("JSON");
});

it("shows source changes instead of downloading a stale export", async () => {
  handler = (url) =>
    url.pathname.endsWith("/export")
      ? new Response(
          JSON.stringify({
            type: "https://api.alethical.com/problems/records-changed",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/problem+json" },
          },
        )
      : undefined;
  await render();
  await click(buttons("Download CSV")[0]);
  expect(container.textContent).toContain("These records changed");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(buttons("Reload comparison").length).toBeGreaterThan(0);
});

it("copies only public address state, preserving comparison return context", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await render("&private_review=secret&token=secret&expenseQuery=Robin");
  await click(buttons("Copy link")[0]);
  const copied = new URL(writeText.mock.calls[0][0]);
  expect(copied.searchParams.get("expenseQuery")).toBe("Robin");
  expect(copied.searchParams.get("q")).toBe("old-race-search");
  expect(copied.searchParams.get("page")).toBe("3");
  expect(copied.searchParams.has("token")).toBe(false);
  expect(copied.searchParams.has("private_review")).toBe(false);
  expect(container.textContent).toContain("Link copied");
});

it("opens exact retained report bytes with separate figure locators and no invented received date", async () => {
  await render();
  await click(buttons("View report")[0]);
  expect(container.textContent).toContain("Exact retained report.pdf");
  expect(container.textContent).toContain("Page 2, line 7");
  expect(container.textContent).toContain("Page 2, line 11");
  expect(container.textContent).toContain("Nov 11, 2026");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "ReceivedUnavailable",
  );
  expect(
    requests
      .find((url) => url.pathname.includes("/finance/sources/"))
      ?.searchParams.get("collection_id"),
  ).toBe(collection);
});

it("adds exact decimal amounts and credits without binary float or missing-as-zero", () => {
  expect(d.sumMoney(["9007199254740993.01", "-0.02", "0.0099"])).toBe(
    "9007199254740992.9999",
  );
  expect(d.sumMoney(["0.10", "0.20"])).toBe("0.30");
  expect(d.sumMoney([])).toBeNull();
  expect(d.sumMoney(["2.00", null])).toBeNull();
  expect(d.partyLabel("FI")).toBe("FI");
  expect(d.exactKeys(payeeId + "," + payeeId, 200)).toEqual([payeeId]);
});

it("prevents a shared account from receiving two reports in a bulk period choice", () => {
  const source = fixture();
  source.report_options[0].reports.push({
    ...source.report_options[0].reports[0],
    report_key: "9".repeat(64),
  });
  expect(
    d.optionGroups(source).some((option) => option.keys.includes(latest)),
  ).toBe(false);
});

it("labels a known subtotal when candidates without a confirmed report stay in coverage", async () => {
  data.coverage.scoped_candidacies = 4;
  data.summary.candidacy_counts_by_ballot_party.R = 2;
  data.candidates!.push({
    ...candidate(claim("Example Unlinked", "R", "unlinked"), latest, "12345"),
    confirmed_account_count: 0,
    accounts: [],
    gaps: [{ state: "no_confirmed_account" }],
  });
  data.page.total = 4;
  await render();
  const total = container.querySelector(".ex-party tr.ex-total")!;
  expect(total.textContent).toContain("Known subtotal");
  expect(total.textContent).toContain("Covers 3 of 4 candidates");
  expect(container.querySelector(".ex-locations")?.textContent).toContain(
    "Covers 3 of 4 candidates",
  );
  expect(container.textContent).toContain("Example Unlinked");
});

it("live search types, submits immediately, and clearing restores both discovery groups", async () => {
  await render();
  const search = container.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )!;
  await input(search, "Robin");
  await act(async () => {
    await new Promise((done) => setTimeout(done, 260));
  });
  await settle();
  expect(new URL(window.location.href).searchParams.get("expenseQuery")).toBe(
    "Robin",
  );
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Candidates (1)",
  );
  await input(search, "Dana");
  await act(async () =>
    search
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  expect(new URL(window.location.href).searchParams.get("expenseQuery")).toBe(
    "Dana",
  );
  await input(search, "");
  await act(async () => {
    await new Promise((done) => setTimeout(done, 260));
  });
  await settle();
  expect(new URL(window.location.href).searchParams.has("expenseQuery")).toBe(
    false,
  );
  expect(container.querySelector(".ex-candidates")?.textContent).toContain(
    "Candidates (3)",
  );
  expect(container.querySelector(".ex-search-payees")).toBeNull();
});

it("does not start a late or duplicate CSV download after the report scope changes", async () => {
  const downloads = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  let finish: ((response: Response) => void) | undefined;
  handler = (url) =>
    url.pathname.endsWith("/export")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : undefined;
  await render();
  const download = buttons("Download CSV")[0];
  await act(async () => {
    download.click();
    download.click();
  });
  await settle();
  expect(
    requests.filter((url) => url.pathname.endsWith("/export")),
  ).toHaveLength(1);
  expect(buttons("Preparing download…")[0].disabled).toBe(true);
  await act(async () =>
    navigate(rootPath + `&expenseReports=${old}`, { replace: true }),
  );
  await settle();
  await act(async () =>
    finish!(
      new Response("exact,25.75", { headers: { "Content-Type": "text/csv" } }),
    ),
  );
  await settle();
  expect(downloads).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Download started");
});

it("does not mistake the sole filed locality line for a street", () => {
  const original = {
    ...identity,
    address: {
      lines: ["St. Paul, MN 55101"],
      street: null,
      city: "St. Paul",
      state: "MN",
      postal_code: "55101",
    },
  };
  expect(d.addressLines(original)).toEqual([
    "Street address not shown",
    "St. Paul MN 55101",
  ]);
  expect(
    d.addressLines({
      ...identity,
      address: { lines: ["Unparsed address as shown"] },
    }),
  ).toEqual(["Unparsed address as shown"]);
});

it("keeps exclusion ticks and the open panel when applying them fails", async () => {
  await render();
  await click(buttons("Exclude selected payees")[0]);
  await click(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
  );
  handler = (url) =>
    url.pathname.endsWith("/expenses") &&
    url.searchParams.has("excluded_payee_ids")
      ? new Response("", { status: 503 })
      : undefined;
  await click(buttons("Apply exclusions")[0]);
  expect(container.querySelector(".ex-exclusion-panel")).not.toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .checked,
  ).toBe(true);
  expect(container.querySelector(".ex-exclusion-panel")?.textContent).toContain(
    "Couldn’t update results",
  );
});

it("restores the payment source from a copied detail address", async () => {
  await render(
    `&expenseQuery=Robin&expenseCandidate=${encodeURIComponent("race-1:robin")}&expensePayee=${encodeURIComponent("candidate:race-1:robin:" + payeeId)}&expenseSource=${encodeURIComponent("payment:" + "2".repeat(16) + ":" + latest + ":source-row-22")}`,
  );
  expect(container.textContent).toContain("Underlying vendor as filed");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Printing as filed",
  );
  expect(
    requests.filter((url) => url.pathname.endsWith("/payments")),
  ).toHaveLength(1);
});

it("shows the actual source-bound received date without reusing capture or cutoff dates", async () => {
  data.account_reports[0].received_date = "2026-10-26";
  await render();
  await click(buttons("View report")[0]);
  const source = document.querySelector('[role="dialog"]')!;
  expect(source.textContent).toContain("ReceivedOct 26, 2026");
  expect(source.textContent).toContain("CopiedNov 11, 2026");
});

it("pages candidates with exact current pins and moves focus to the list heading", async () => {
  data.page.total = 51;
  handler = (url) =>
    url.searchParams.get("offset") === "50"
      ? json({
          ...data,
          candidates: [candidate(robin, latest, "12345")],
          page: { limit: 50, offset: 50, total: 51 },
        })
      : undefined;
  await render();
  const section = container.querySelector(".ex-candidates")!;
  const next = [...section.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Next",
  )!;
  await click(next);
  const request = requests.find(
    (url) => url.searchParams.get("offset") === "50",
  )!;
  expect(request.searchParams.get("limit")).toBe("50");
  expect(request.searchParams.get("snapshot_id")).toBe(snapshot);
  expect(request.searchParams.get("version")).toBe("1".repeat(16));
  expect(section.textContent).toContain("Page 2 of 2");
  expect(document.activeElement).toBe(section.querySelector("h2"));
});

function externalFixture() {
  const report: d.AuthorityReport = {
    authority: "fec",
    authority_name: "Federal Election Commission",
    account_id: "C00000001",
    account_name: "Example federal campaign",
    report_key: "9".repeat(64),
    source_report_id: "1000001",
    report_type: "Q3",
    period_start: "2026-07-01",
    period_end: "2026-09-30",
    received_date: "2026-10-15",
    claims: [dana],
    display_claims: [dana],
    party_group: "DFL",
    party_classification_state: "single_ballot_party",
    reported_measures: [
      {
        measure: "fec_total_disbursements",
        label: "Disbursements this period",
        value: "1234.99",
        unit: "dollars",
        currency: "USD",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        basis: "reported",
        sources: [
          {
            source_sha256: "8".repeat(64),
            locator: { row: 2, column: 18 },
            quote: "1234.99",
            source_copied_at: "2026-11-10T12:00:00Z",
          },
        ],
      },
    ],
    reported_itemized_before_exclusions: [
      {
        authority: "fec",
        report_key: "9".repeat(64),
        measure: "fec_operating_expenditure",
        label: "Operating expenditures",
        basis: "Schedule B",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        currency: "USD",
        amount: "34.99",
      },
    ],
    reported_itemized_after_exclusions: [],
    public_subsidy: null,
    public_subsidy_gap: "no_checked_subsidy_measure",
    detail_status: "partial_itemized",
    detail_gap: "itemized_rows_do_not_establish_complete_schedule",
    memo_detail_count: 1,
    sources: [
      {
        source_sha256: "8".repeat(64),
        locator: { row: 2 },
        quote: "exact federal cover",
      },
    ],
  };
  data.external_generation_id = "7".repeat(64);
  data.external_status = "published";
  data.authority_reports = [report];
  data.candidates![0].accounts = [];
  data.candidates![0].external_accounts = [
    {
      authority: "fec",
      authority_name: report.authority_name,
      account_id: report.account_id,
      name: report.account_name,
      source_candidate_id: "H6MN00001",
      checked_on: "2026-11-12",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
    },
  ];
  report.reported_itemized_after_exclusions = structuredClone(
    report.reported_itemized_before_exclusions,
  );
  data.report_options.push({
    authority: "fec",
    authority_name: report.authority_name,
    account_id: report.account_id,
    registration_number: report.account_id,
    reports: [
      {
        report_key: report.report_key,
        collection_id: "",
        filing: {
          report_type: "Q3",
          report_name: "Q3",
          cut_off_date: "2026-09-30",
        },
        period_start: report.period_start,
        period_end: report.period_end,
        period_basis: "source_report_interval",
        document_hash: "8".repeat(64),
        selected: true,
        source_state: "available",
      },
    ],
  });
  return report;
}
it("keeps native report amounts apart across currencies and periods", async () => {
  const report = externalFixture();
  const before = report.reported_itemized_before_exclusions![0];
  report.reported_itemized_after_exclusions = [
    { ...before, currency: "CAD", amount: "9999.99" },
    { ...before, currency: "USD", amount: "12.99" },
  ];
  await render();
  const native = container.querySelector(".ex-authority-account")!;
  expect(native.textContent).toContain("$12");
  expect(native.textContent).not.toContain("$9,999");
  expect(reportedMoneyLabel("12.99", "CAD")).toBe("12 CAD");
  expect(reportedMoneyLabel("12.99", null)).toBe("12 currency unavailable");
  expect(reportedMoneyLabel("-0.99", "USD")).toBe("−$0");
  const summary = {
    ...before,
    authority_name: report.authority_name,
    account_id: report.account_id,
    baseline: before.amount,
    adjusted: "12.99",
    by_party: {},
    by_filed_address: {},
  } as d.AuthoritySummary;
  const groups = authorityGroups([
    summary,
    { ...summary, account_id: "C00000002", report_key: "6".repeat(64) },
    { ...summary, currency: "CAD" },
    { ...summary, period_start: "2026-01-01" },
    { ...summary, authority: "mn_local" },
    { ...summary, measure: "other_measure" },
    { ...summary, basis: "other_basis" },
  ]);
  expect(groups).toHaveLength(6);
  expect(groups[0][1]).toHaveLength(2);
});
it("shows federal expense measures and partial itemization without a fabricated Board split or subsidy", async () => {
  externalFixture();
  await render();
  const card = container.querySelector(".ex-authority-account")!;
  expect(card.textContent).toContain("Disbursements this period");
  expect(card.textContent).toContain("$1,234");
  expect(card.textContent).toContain("Public subsidy unavailable");
  expect(card.textContent).toContain("Itemized records may be partial");
  expect(card.textContent).not.toContain("In-kind");
  expect(card.textContent).not.toContain("Unpaid");
  expect(card.textContent).not.toContain("$0");
  expect(buttons("View payees")[0].disabled).toBe(false);
});
it("opens the exact external figure source and uses its copy date rather than generation time", async () => {
  const report = externalFixture();
  handler = (url) =>
    url.pathname.includes("/external-finance/sources/")
      ? new Response("source", { headers: { "Content-Type": "text/plain" } })
      : undefined;
  await render(
    `&expenseSource=external-report:${report.report_key}:figure.0:0`,
  );
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain("Federal Election Commission");
  expect(panel.textContent).toContain("CopiedNov 10, 2026");
  expect(panel.textContent).toContain("1234.99");
  const source = requests.find((url) =>
    url.pathname.includes("/external-finance/sources/"),
  )!;
  expect(source.pathname).toContain("8".repeat(64));
  expect(source.searchParams.get("generation_id")).toBe("7".repeat(64));
});
it("keeps external report selections for candidate payee drilldown", () => {
  const report = externalFixture();
  expect(
    d.scopedReportKeys(
      data,
      [report.report_key, old],
      (c) => c.candidate_id === dana.candidate_id,
    ),
  ).toContain(report.report_key);
  expect(
    d
      .optionGroups(data)
      .some(
        (group) =>
          group.label.includes("Federal Election Commission") &&
          group.keys.includes(report.report_key),
      ),
  ).toBe(true);
});
it("renders external payees and memo payment detail with amounts=null", async () => {
  const report = externalFixture();
  const externalPayee = {
    ...payee(),
    authority: "fec",
    authority_name: report.authority_name,
    amounts: null,
    report_keys: [report.report_key],
    reported_amounts: report.reported_itemized_before_exclusions!,
    source: report.sources,
  };
  handler = (url) => {
    if (url.pathname.endsWith("/payees"))
      return json({
        ...data,
        payees: [externalPayee],
        page: { limit: 50, offset: 0, total: 1 },
      });
    if (url.pathname.endsWith("/payments"))
      return json({
        ...data,
        payments: [
          {
            ...payment(),
            authority: "fec",
            authority_name: report.authority_name,
            account_id: report.account_id,
            amounts: null,
            reported_amount: "34.99",
            currency: "USD",
            measure_label: "Operating expenditure",
            nonadditive: true,
            report_key: report.report_key,
            source: report.sources,
          },
        ],
        page: { limit: 50, offset: 0, total: 1 },
      });
  };
  await render(`&expenseCandidate=${encodeURIComponent(d.claimKey(dana))}`);
  expect(container.querySelector(".ex-payee-main")?.textContent).toContain(
    "$34",
  );
  await click(buttons("View payments")[0]);
  const payments = container.querySelector(".ex-payments")!;
  expect(payments.textContent).toContain("Operating expenditure");
  expect(payments.textContent).toContain(
    "Supplemental memo, not added to spending",
  );
  expect(payments.textContent).not.toContain("Unpaid");
});
