import { navigate } from "../router";
import { ElectionComparison } from "../pages/elections/Comparison";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearReadCache } from "../api/read";
import { Funders } from "../pages/elections/Funders";
import {
  changeElection,
  funderReturnHref,
  reportHref,
} from "../pages/elections/navigation";
import * as d from "../pages/elections/funderData";
import type { ElectionSummary } from "../pages/elections/data";
import fixture from "./fixtures/electionComparison.json";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../auth/session", () => ({
  useFinanceSession: () => ({
    apiBaseUrl: "https://api.example.test",
    accessToken: "reader-token",
    status: "granted",
    email: "reader@example.test",
    retry: vi.fn(),
    revoked: false,
  }),
}));
let container: HTMLDivElement, root: Root, paths: string[], changed: boolean;
const measure = (amount: string | null): d.Measure => ({
  state: amount === null ? "no_records" : "reported",
  record_count: amount === null ? 0 : 1,
  amount,
  known_amount_subtotal: amount,
  missing_amount_count: 0,
});
const context: d.Context = {
  election_key: fixture.detail.election_key,
  election_date: "2026-11-03",
  snapshot_id: fixture.detail.snapshot_id,
  version: "d".repeat(16),
  release_id: "release",
  reported_year: 2026,
  filters: {},
  scope_note: "Calendar-year records",
  sources: {
    contributions: {
      snapshot_id: "s",
      content_hash: "a".repeat(64),
      copied_at: "2026-11-12",
      source_url: "https://cfb.mn.gov/original.csv",
      retained_source_url: "",
      retained_original_state: "held",
    },
  },
};
const funder: d.Funder = {
  funder_id: "one",
  registration_number: "123",
  names: ["Example funder"],
  identity_state: "checked",
  recorded_classifications: [
    {
      category: "PCF",
      recorded_type: "Political committee",
      recorded_subtype: null,
    },
  ],
  amounts: {
    direct_contributions: measure("-12.99"),
    independent_For: measure("0.50"),
    independent_Against: measure(null),
    independent_unknown: measure(null),
  },
  supported_outcomes: {
    candidacies: 2,
    elected: 1,
    not_elected: 0,
    pending: 1,
  },
  opposed_outcomes: { candidacies: 1, elected: 0, not_elected: 1, pending: 0 },
  support_count_review: { state: "review_negative_records" },
};
const page = { total: 1, limit: 50, offset: 0, has_more: false };
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
const buttons = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.includes(text),
  );
async function settle() {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
async function render() {
  await act(async () =>
    root.render(
      <Funders
        election={fixture.detail as ElectionSummary}
        elections={[fixture.detail as ElectionSummary]}
        backHref="/money/races?election=mn-2026-11-03-general"
        onElectionChange={vi.fn()}
        onRemoveRace={vi.fn()}
      />,
    ),
  );
  await settle();
}
beforeEach(() => {
  clearReadCache();
  paths = [];
  changed = false;
  window.history.replaceState(
    null,
    "",
    "/money/races?election=mn-2026-11-03-general&report=funders",
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      paths.push(input);
      const url = new URL(input);
      if (changed && url.pathname.endsWith("/candidates"))
        return new Response(
          JSON.stringify({
            type: "https://api.alethical.com/problems/records-changed",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/problem+json" },
          },
        );
      if (url.pathname.endsWith("/funders"))
        return json({
          ...context,
          filters: { q: url.searchParams.get("q") || "" },
          funders: [funder],
          page,
        });
      if (url.pathname.endsWith("/candidates"))
        return json({
          ...context,
          page,
          candidates: [
            {
              name: "Example candidate",
              candidate_id: "candidate",
              race_id: fixture.detail.race.id,
              race_label: "Attorney General",
              party: "DFL",
              district: null,
              votes: 10,
              outcome: "elected",
              outcome_status: "certified",
              result_status: "certified",
              supported: true,
              opposed: false,
              candidate_source_sha256: null,
              candidate_source_row: null,
              evidence: [],
              amounts: funder.amounts,
            },
          ],
        });
      if (url.pathname.endsWith("/records"))
        return json({ ...context, page: { ...page, total: 0 }, rows: [] });
      throw new Error(`Unexpected route ${url.pathname}`);
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps documented support counts separate from net money and preserves pending outcomes", async () => {
  await render();
  expect(container.textContent).toContain("Candidates supported (2)");
  expect(container.textContent).toContain("Pending1");
  expect(container.textContent).toContain("Candidates opposed (1)");
  expect(container.textContent).toContain("−$12");
  expect(container.textContent).not.toContain("−$13");
  expect(container.textContent).toContain("Net amount is negative");
  expect(container.textContent).toContain("No records");
  expect(container.textContent).not.toContain(".99");
});
it("opens candidate outcomes with the same pins and returns from the race to the funder filter", async () => {
  await render();
  await click(buttons("View candidates")[0]);
  const request = new URL(
    paths.find((path) => new URL(path).pathname.endsWith("/candidates"))!,
  );
  expect(request.searchParams.get("snapshot_id")).toBe(context.snapshot_id);
  expect(request.searchParams.get("version")).toBe(context.version);
  expect(container.textContent).toContain("Example candidate");
  const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
    (a) => a.textContent === "View race",
  )!;
  const target = new URL(link.href);
  expect(target.searchParams.get("race")).toBe(fixture.detail.race.id);
  const back = funderReturnHref(target)!;
  expect(back).toContain("report=funders");
  expect(back).toContain("funder=one");
});
it("reloads candidate evidence after changed records instead of reusing the cached refusal", async () => {
  await render();
  changed = true;
  await click(buttons("View candidates")[0]);
  expect(container.textContent).toContain("These records changed");
  changed = false;
  await click(buttons("Reload comparison")[0]);
  expect(container.textContent).toContain("Example candidate");
  expect(
    paths.filter((path) => new URL(path).pathname.endsWith("/candidates")),
  ).toHaveLength(2);
});
it("keeps source and auth secrets out of report navigation and rejects foreign return state", () => {
  const url = new URL(
    "https://alethicalfinance.com/money/races?election=mn-2026-11-03-general&race=r&report=funders&fq=Example&funder=one&token=secret&expenseExcluded=old",
  );
  expect(reportHref(url, "comparison")).not.toContain("token");
  expect(reportHref(url, "comparison")).not.toContain("expenseExcluded");
  expect(reportHref(url, "comparison")).not.toContain("fq=");
  expect(changeElection(url, "mn-2024-11-05-general")).toBe(
    "/money/races?election=mn-2024-11-05-general&report=funders",
  );
  url.searchParams.set("freturn", "https://outside.example/");
  expect(funderReturnHref(url)).toBeNull();
  url.searchParams.set("freturn", "?report=funders&election=wrong");
  expect(funderReturnHref(url)).toBeNull();
});
it("validates actual calendar dates without rolling impossible dates into another month", () => {
  expect(d.inputDate("02/30/2026")).toBeNull();
  expect(d.inputDate("02/29/2024")).toBe("2024-02-29");
  expect(d.inputDate("2/1/2026")).toBeNull();
  expect(d.inputDate("")).toBe("");
});

it("CSV admission prevents two synchronous starts for one scope", async () => {
  const original = globalThis.fetch;
  let downloads = 0;
  const releases: Array<(response: Response) => void> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:csv");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      if (new URL(input).pathname.endsWith("/export")) {
        downloads += 1;
        return new Promise<Response>((resolve) => releases.push(resolve));
      }
      return original(input, options);
    }),
  );
  await render();
  const button = buttons("Download CSV")[0];
  await act(async () => {
    button.click();
    button.click();
  });
  await settle();
  const observed = downloads;
  await act(async () =>
    releases.forEach((finish) =>
      finish(
        new Response("Row type,Exact amount\nPayment,12.99", {
          headers: { "Content-Type": "text/csv" },
        }),
      ),
    ),
  );
  await settle();
  expect(observed).toBe(1);
});

it("old candidate rows retain an explicit old scope when date-filter details fail", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input);
      if (
        url.pathname.endsWith("/candidates") &&
        url.searchParams.has("start_date")
      )
        return new Response("", { status: 503 });
      const response = await original(input, options);
      if (
        url.pathname.endsWith("/funders") &&
        url.searchParams.has("start_date")
      )
        return json({
          ...context,
          filters: { start_date: url.searchParams.get("start_date") },
          funders: [
            {
              ...funder,
              supported_outcomes: {
                candidacies: 0,
                elected: 0,
                not_elected: 0,
                pending: 0,
              },
            },
          ],
          page,
        });
      return response;
    }),
  );
  await render();
  await click(buttons("View candidates")[0]);
  await act(async () =>
    navigate(
      "/money/races?election=mn-2026-11-03-general&report=funders&funder=one&panel=candidates&start=2026-10-20",
      { replace: true },
    ),
  );
  await settle();
  const detail = container.querySelector(".ef-detail")!;
  expect(container.textContent).toContain("Candidates supported (0)");
  expect(detail.textContent).toContain("Example candidate");
  expect(detail.textContent).toContain("Couldn’t update results");
  expect(detail.textContent).toContain("Showing previous");
});

it("stale clipboard completion cannot mark the new filters copied", async () => {
  let finish: (() => void) | undefined;
  const writeText = vi.fn(
    (_text: string) =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await render();
  await click(buttons("Copy link")[0]);
  await act(async () =>
    navigate(
      "/money/races?election=mn-2026-11-03-general&report=funders&fq=Different",
      {
        replace: true,
      },
    ),
  );
  await settle();
  await act(async () => finish!());
  await settle();
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(new URL(writeText.mock.calls[0][0]).searchParams.has("fq")).toBe(
    false,
  );
  expect(container.textContent).not.toContain("Link copied");
});

it("dataset originals use the authenticated, pinned analytics route", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: URL; options: RequestInit }> = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:source");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      if (new URL(input).pathname.includes("/analytics/sources/")) {
        calls.push({ url: new URL(input), options });
        return new Response("retained exact source", {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
      return original(input, options);
    }),
  );
  await render();
  await click(buttons("Itemized contributions received")[0]);
  expect(calls).toHaveLength(1);
  expect(calls[0].options.headers).toEqual({
    Authorization: "Bearer reader-token",
  });
  expect(calls[0].url.searchParams.get("snapshot_id")).toBe(
    context.snapshot_id,
  );
  expect(calls[0].url.searchParams.get("version")).toBe(context.version);
  expect(document.querySelector('a[href="blob:source"]')).not.toBeNull();
});

it("removing a race starts the broader funder scope on page 1", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/elections"))
        return json({ elections: [fixture.detail] });
      if (url.pathname.includes("/races/")) return json(fixture.detail);
      if (url.pathname.endsWith("/funders"))
        return json({
          ...context,
          filters: { race_id: url.searchParams.get("race_id") },
          funders: [funder],
          page: {
            limit: 50,
            offset: Number(url.searchParams.get("offset") || 0),
            total: 101,
            has_more: true,
          },
        });
      return original(input, options);
    }),
  );
  window.history.replaceState(
    null,
    "",
    "/money/races?election=mn-2026-11-03-general&report=funders&race=" +
      fixture.detail.race.id +
      "&fpage=2&fq=Example&start=2026-01-01",
  );
  await act(async () => root.render(<ElectionComparison />));
  await settle();
  await click(buttons("Remove race filter")[0]);
  const query = new URL(window.location.href).searchParams;
  expect(query.get("race")).toBeNull();
  expect(query.get("fq")).toBe("Example");
  expect(query.get("start")).toBe("2026-01-01");
  expect(query.get("fpage") ?? "1").toBe("1");
});

it("a payment excluded only by selected dates keeps that exact reason", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input);
      if (
        url.pathname.endsWith("/records") &&
        url.searchParams.get("metric") === "direct_contributions"
      )
        return json({
          ...context,
          page,
          rows: [
            {
              dataset: "contributions",
              row_number: 10,
              funder_id: funder.funder_id,
              funder_name: "Example funder",
              date: "2026-10-01",
              amount: "12.99",
              metric: "direct_contributions",
              resolution: "outside_selected_period",
              fields: { Recipient: "Exact recipient as filed" },
              claims: [
                { race_id: fixture.detail.race.id, candidate_id: "candidate" },
              ],
              related_candidacies: [
                { race_id: fixture.detail.race.id, candidate_id: "candidate" },
              ],
              source: context.sources.contributions,
            },
          ],
        });
      return original(input, options);
    }),
  );
  await render();
  await click(buttons("View payments")[0]);
  const row = container.querySelector(".ef-payments li")!;
  expect(row.textContent).not.toContain("Attribution unavailable");
  expect(row.textContent).toContain("Outside selected payment dates");
});
it("returns from each report with the selected comparison filing and precinct scope intact", () => {
  const original = new URL(
    `https://alethicalfinance.com/money/races?election=mn-2026-11-03-general&race=r&q=Attorney&reports=123:${"a".repeat(64)}&pq=Ward&ppage=2&votesView=table&token=secret`,
  );
  for (const mode of ["funders", "expenses"] as const) {
    const report = new URL(reportHref(original, mode), original.origin);
    const returned = new URL(reportHref(report, "comparison"), original.origin);
    for (const key of [
      "election",
      "race",
      "q",
      "reports",
      "pq",
      "ppage",
      "votesView",
    ]) {
      expect(returned.searchParams.get(key)).toBe(
        original.searchParams.get(key),
      );
    }
    expect(returned.searchParams.has("token")).toBe(false);
  }
});
