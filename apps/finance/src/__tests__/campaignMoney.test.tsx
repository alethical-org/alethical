import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearReadCache } from "../api/read";
import {
  CampaignMoney,
  countLine,
  pageCount,
  pageFromParam,
  punctuateGroup,
  registerPath,
  registrationStatus,
  sourceGroups,
  tabFromParam,
  type CommitteeRegister,
} from "../pages/CampaignMoney";
import { matchRoute } from "../routes";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://api.example.test";

vi.mock("../auth/session", () => ({
  useFinanceSession: () => ({
    apiBaseUrl: "https://api.example.test",
    accessToken: "token",
  }),
}));

function register(
  overrides: Partial<CommitteeRegister> = {},
): CommitteeRegister {
  return {
    state: "reported",
    kind: "candidate_committee",
    committees: [
      {
        registration_number: "18135",
        name: "Hortman (Melissa) Campaign Committee",
        kind: "candidate_committee",
        sub_type: null,
        office: "House",
        district: "34B",
        is_closed: false,
        termination_date: null,
      },
    ],
    page: { limit: 50, offset: 0, has_more: false, total: 1 },
    register_total: 1607,
    by_kind: {
      candidate_committee: 762,
      party_unit: 299,
      political_committee_or_fund: 546,
    },
    held_by_kind: {
      candidate_committee: 762,
      party_unit: 299,
      political_committee_or_fund: 546,
    },
    as_of: "2026-10-28",
    reason: null,
    ...overrides,
  };
}

const SUMMARY = {
  freshness: {
    payment_copied_at: {
      contributions: "2026-10-09T21:05:10Z",
      expenditures: "2026-10-09T21:05:10Z",
      independent_expenditures: "2026-10-09T21:05:10Z",
    },
    register_fetched_at: "2026-10-28T15:41:49Z",
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Answer = (url: string) => Response | Promise<Response>;

async function render(path: string, answer: Answer) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input.includes("/campaign-finance/summary")) return json(SUMMARY);
      return answer(input);
    }),
  );
  const match = matchRoute("/money")!;
  await act(async () => {
    root.render(<CampaignMoney match={match} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function registerRequests() {
  return requests.filter((url) => url.includes("/finance/committees"));
}

const SEARCH_MATCHES = [
  {
    kind: "candidate_committee",
    name: "Example candidate committee",
    id: "18135",
  },
  {
    kind: "political_committee_or_fund",
    name: "Example education fund",
    id: "30004",
  },
  { kind: "party_unit", name: "Example party unit", id: "40001" },
] as const;

function matchingRegister(url: string) {
  const params = new URL(url).searchParams;
  const match = SEARCH_MATCHES.find(
    (item) => item.kind === params.get("kind"),
  )!;
  return register({
    kind: match.kind,
    q: params.get("q"),
    status: params.get("status"),
    party: params.get("party"),
    candidate_parties: ["DFL", "Republican"],
    committees: [
      {
        ...register().committees[0],
        name: match.name,
        registration_number: match.id,
        kind: match.kind,
        party: match.kind === "candidate_committee" ? "DFL" : null,
      },
    ],
  });
}

describe("Campaign money search across browsing categories", () => {
  it.each(["", "candidates"])(
    "hides a retained zero count after a missing response in view %s",
    async (view) => {
      await render(
        `/money?q=Example&party=DFL${view ? `&view=${view}` : ""}`,
        (url) => {
          const params = new URL(url).searchParams;
          if (params.get("kind") === "candidate_committee") {
            if (params.get("status") === "open") return json(null, 404);
            return json({
              ...matchingRegister(url),
              committees: [],
              page: { limit: 50, offset: 0, has_more: false, total: 0 },
            });
          }
          return json(matchingRegister(url));
        },
      );
      const group = container.querySelector(
        'section[aria-label="Candidate committees"]',
      )!;
      const registration = [
        ...group.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.startsWith("Registration:"))!;
      await act(async () => registration.click());
      const open = [
        ...group.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
      ].find((button) => button.textContent === "Open registrations")!;
      await act(async () => open.click());
      await settle();
      expect(group.querySelector('[role="alert"]')).not.toBeNull();
      const heading = view
        ? container.querySelector('[role="tab"][aria-selected="true"]')
        : group.querySelector("h3");
      expect(heading?.textContent).toBe("Candidate committees");
    },
  );

  it("moves keyboard focus to results after view transitions and to the input on clear", async () => {
    await render("/money?q=Example", (url) => {
      const data = matchingRegister(url);
      return json({
        ...data,
        page: { limit: 50, offset: 0, has_more: false, total: 8 },
      });
    });
    const full = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) =>
        link.textContent?.trim() === "View all matching candidate committees",
    )!;
    expect(new URL(full.href).searchParams.get("view")).toBe("candidates");
    full.focus();
    await act(async () => full.click());
    await settle();
    expect(document.activeElement).toBe(
      container.querySelector(".cm-search-title h2"),
    );
    const back = container.querySelector<HTMLAnchorElement>(".cm-back")!;
    expect(new URL(back.href).searchParams.has("view")).toBe(false);
    back.focus();
    await act(async () => back.click());
    await settle();
    expect(document.activeElement).toBe(
      container.querySelector(".cm-search-title h2"),
    );
    const clear = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Clear search")!;
    clear.focus();
    await act(async () => clear.click());
    await settle();
    expect(document.activeElement).toBe(container.querySelector("#money-name"));
  });

  it.each(["candidates", "committees", "party"])(
    "finds every matching category when search starts from %s",
    async (tab) => {
      await render(`/money?tab=${tab}&q=Example`, (url) =>
        json(matchingRegister(url)),
      );
      expect(
        new Set(
          registerRequests().map((url) =>
            new URL(url).searchParams.get("kind"),
          ),
        ),
      ).toEqual(new Set(SEARCH_MATCHES.map((item) => item.kind)));
      for (const match of SEARCH_MATCHES) {
        expect(container.textContent).toContain(match.name);
      }
      for (const url of registerRequests()) {
        expect(new URL(url).searchParams.get("q")).toBe("Example");
      }
    },
  );

  it("keeps successful matching groups when another group fails", async () => {
    await render("/money?tab=candidates&q=Example", (url) =>
      new URL(url).searchParams.get("kind") === "political_committee_or_fund"
        ? json(null, 503)
        : json(matchingRegister(url)),
    );
    expect(container.textContent).toContain("Example candidate committee");
    expect(container.textContent).toContain("Example party unit");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Try again");
    expect(container.textContent).not.toContain("0 committees");
    expect(container.textContent).not.toContain("No matching records");
  });

  it("labels a failed group with its previous query while other groups show the new query", async () => {
    await render("/money?q=Example&party=DFL", (url) => {
      const params = new URL(url).searchParams;
      if (
        params.get("q") === "Changed" &&
        params.get("kind") === "candidate_committee"
      ) {
        return json(null, 500);
      }
      const data = matchingRegister(url);
      return json({
        ...data,
        committees: data.committees.map((row) => ({
          ...row,
          name: row.name.replace("Example", params.get("q")!),
        })),
      });
    });
    const input = container.querySelector<HTMLInputElement>("#money-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Changed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await settle();
    const failed = container.querySelector(
      'section[aria-label="Candidate committees"]',
    )!;
    expect(failed.textContent).toContain("Example candidate committee");
    expect(failed.textContent).toContain(
      "Previous results: Candidate committees · All registrations · DFL · Matching “Example”",
    );
    expect(failed.querySelector("h3")?.textContent).toBe(
      "Candidate committees",
    );
    expect(failed.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Changed education fund");
    expect(container.textContent).toContain("Changed party unit");
  });

  it("keeps candidate party filtering out of other matching categories", async () => {
    await render("/money?q=Example&party=DFL", (url) =>
      json(matchingRegister(url)),
    );
    const reads = registerRequests().map((url) => new URL(url).searchParams);
    expect(new Set(reads.map((params) => params.get("kind"))).size).toBe(3);
    for (const params of reads) {
      expect(params.get("party")).toBe(
        params.get("kind") === "candidate_committee" ? "DFL" : null,
      );
    }
    expect(container.textContent).toContain("Example education fund");
    expect(container.textContent).toContain("Example party unit");
  });

  it("returns an out-of-category detail to the exact directory search and filters", async () => {
    const path =
      "/money?tab=party&q=Example&reg=open&sort=registration&from=%2Fhome";
    await render(path, (url) => json(matchingRegister(url)));
    const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent === "Example education fund",
    );
    expect(link).toBeTruthy();
    const target = new URL(link!.href);
    expect(target.pathname).toBe("/money/committees/30004");
    expect(target.searchParams.get("from")).toBe(path);
  });

  it("previews 5 matches and pages each full group in batches of 50", async () => {
    await render("/money?tab=party&q=Example", (url) => {
      const data = matchingRegister(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json({
        ...data,
        committees: Array.from({ length: 50 }, (_, i) => ({
          ...data.committees[0],
          name: `${data.committees[0].name} ${offset + i + 1}`,
          registration_number: String(
            Number(data.committees[0].registration_number) + offset + i,
          ),
        })),
        page: { limit: 50, offset, total: 120, has_more: offset < 100 },
      });
    });
    expect(container.querySelectorAll(".cm-row:not(.cm-head)")).toHaveLength(
      15,
    );
    expect(container.querySelector(".cm-pager")).toBeNull();
    const full = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) =>
        link.textContent?.trim() === "View all matching committees and funds",
    )!;
    await act(async () => full.click());
    await settle();
    expect(container.querySelectorAll(".cm-row:not(.cm-head)")).toHaveLength(
      50,
    );
    expect(container.textContent).toContain("Page 1 of 3");
    expect(
      container.querySelector(".cm-table")?.nextElementSibling?.className,
    ).toBe("cm-pager");
    const next = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Next")!;
    await act(async () => next.click());
    await settle();
    expect(container.textContent).toContain("Example education fund 51");
    expect(new URLSearchParams(location.search).get("spage_committees")).toBe(
      "2",
    );
    const last = new URL(registerRequests().at(-1)!).searchParams;
    expect(last.get("kind")).toBe("political_committee_or_fund");
    expect(last.get("offset")).toBe("50");
    expect(last.get("limit")).toBe("50");
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(async () => tabs[0].click());
    await settle();
    expect(container.textContent).toContain("Page 1 of 3");
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(),
    );
    await settle();
    expect(container.textContent).toContain("Page 2 of 3");
    expect(container.textContent).toContain("Example education fund 51");
  });

  it("keeps empty group recovery filters and changes only that group", async () => {
    await render(
      "/money?q=Example&reg_committees=open&party_candidates=DFL",
      (url) => {
        const data = matchingRegister(url);
        return json({
          ...data,
          committees: [],
          page: { limit: 50, offset: 0, total: 0, has_more: false },
        });
      },
    );
    expect(container.textContent).not.toContain("No matches for “Example”");
    expect(container.querySelectorAll(".cm-group")).toHaveLength(3);
    expect(container.querySelector('[role="table"]')).toBeNull();
    expect(container.textContent).not.toContain("Sort by:");
    const group = container.querySelector<HTMLElement>(
      'section[aria-label="Committees and funds"]',
    )!;
    expect(group.textContent).toContain("Committees and funds (0)");
    expect(group.textContent).toContain("Registration: Open registrations");
    const clear = [...group.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Clear all",
    )!;
    const before = registerRequests().length;
    await act(async () => clear.click());
    await settle();
    const changed = registerRequests()
      .slice(before)
      .map((url) => new URL(url).searchParams);
    expect(changed).toHaveLength(1);
    expect(changed[0].get("kind")).toBe("political_committee_or_fund");
    expect(changed[0].get("status")).toBe("all");
    expect(new URLSearchParams(location.search).get("party_candidates")).toBe(
      "DFL",
    );
  });

  it("restores browse choices on clear and creates history only for entering and leaving search", async () => {
    const path = "/money?tab=committees&reg=open&sort=registration&page=2";
    await render(path, (url) => {
      const data = matchingRegister(url);
      return json({
        ...data,
        page: {
          limit: 50,
          offset: Number(new URL(url).searchParams.get("offset")),
          total: 120,
          has_more: true,
        },
      });
    });
    const push = vi.spyOn(window.history, "pushState");
    async function search(value: string) {
      const input = container.querySelector<HTMLInputElement>("#money-name")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        input.form!.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      await settle();
    }
    await search("Example");
    expect(push).toHaveBeenCalledTimes(1);
    await search("Examples");
    expect(push).toHaveBeenCalledTimes(1);
    const clear = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Clear search")!;
    await act(async () => clear.click());
    await settle();
    expect(push).toHaveBeenCalledTimes(2);
    expect(location.pathname + location.search).toBe(path);
    expect(
      container.querySelector('[aria-selected="true"]')?.textContent,
    ).toContain("Committees and funds");
    expect(container.textContent).toContain("Page 2 of 3");
    expect(container.textContent).toContain("Registration: Open registrations");
    expect(container.textContent).toContain("Sort by: Registration number");
    push.mockRestore();
  });
});

describe("Campaign money directory", () => {
  it("renders registration search, held party and explicit retained and dated status", async () => {
    const base = register().committees[0];
    await render("/money?q=18135", () =>
      json(
        register({
          committees: [
            {
              ...base,
              party: "DFL",
              registration_date: "2020-01-02",
              registration_status: "open",
            },
            {
              ...base,
              registration_number: "9",
              name: "Earlier committee",
              is_closed: false,
              retained: true,
              registration_status: "not_listed",
              registration_date: "2019-01-02",
            },
          ],
        } as Partial<CommitteeRegister>),
      ),
    );
    expect(container.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Search by name or registration number",
    );
    expect(container.textContent).toContain("Candidate committee · DFL");
    expect(container.textContent).toContain("Registered Jan 2, 2020");
    expect(container.textContent).toContain(
      "No longer listed in the current register",
    );
    expect(container.textContent).not.toContain("Registered Jan 2, 2019");
    expect(registerRequests()[0]).toContain("q=18135");
    expect(registerRequests()[0]).toContain("status=all");
  });

  it("sends registration filters to the server and resets paging", async () => {
    await render("/money?page=3", () => json(register()));
    const menu = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Registration:"),
    );
    expect(menu).toBeTruthy();
    await act(async () => menu!.click());
    const open = [...container.querySelectorAll('[role="option"] button')].find(
      (b) => b.textContent === "Open registrations",
    );
    await act(async () => (open as HTMLButtonElement).click());
    await settle();
    expect(registerRequests().at(-1)).toContain("status=open");
    expect(registerRequests().at(-1)).toContain("offset=0");
    expect(window.location.search).toContain("reg=open");
    const clear = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Clear all",
    );
    await act(async () => clear!.click());
    await settle();
    expect(registerRequests().at(-1)).toContain("status=all");
  });

  it("keeps a failed filter change labelled with the last loaded registration scope", async () => {
    let release: (value: Response) => void = () => {};
    await render("/money?reg=open", (url) =>
      url.includes("status=terminated")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : json(
            register({ status: "open", q: null } as Partial<CommitteeRegister>),
          ),
    );
    const menu = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Registration:"),
    );
    expect(menu).toBeTruthy();
    await act(async () => menu!.click());
    const option = [
      ...container.querySelectorAll('[role="option"] button'),
    ].find((b) => b.textContent === "Terminated registrations");
    await act(async () => (option as HTMLButtonElement).click());
    expect(container.textContent).toContain(
      "Previous results: Candidate committees · Open registrations",
    );
    expect(container.textContent).toContain("Hortman");
    await act(async () => release(new Response("", { status: 500 })));
    await settle();
    expect(container.textContent).toContain(
      "Previous results: Candidate committees · Open registrations",
    );
    expect(container.textContent).toContain("Try again");
  });

  it("uses all held candidate party options and clears party on a tab change", async () => {
    await render("/money?page=3", (url) => {
      const params = new URL(url).searchParams;
      return json(
        register({
          kind: params.get("kind"),
          party: params.get("party"),
          candidate_parties: ["DFL", "Republican"],
        }),
      );
    });
    const menu = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Party:"),
    );
    expect(menu).toBeTruthy();
    await act(async () => menu!.click());
    const option = [
      ...container.querySelectorAll('[role="option"] button'),
    ].find((b) => b.textContent === "DFL");
    await act(async () => (option as HTMLButtonElement).click());
    await settle();
    expect(registerRequests().at(-1)).toContain("party=DFL");
    expect(registerRequests().at(-1)).toContain("offset=0");
    expect(window.location.search).toContain("party=DFL");
    const nextTab = [
      ...container.querySelectorAll('[role="tab"]'),
    ][1] as HTMLButtonElement;
    await act(async () => nextTab.click());
    await settle();
    expect(registerRequests().at(-1)).not.toContain("party=");
    expect(window.location.search).not.toContain("party=");
    expect(
      [...container.querySelectorAll("button")].some((b) =>
        b.textContent?.startsWith("Party:"),
      ),
    ).toBe(false);
  });

  it("uses retained capture date, never the current register date, and trusts explicit unknown status", async () => {
    const base = register().committees[0];
    await render("/money", () =>
      json(
        register({
          committees: [
            {
              ...base,
              registration_number: "1",
              name: "Retained",
              retained: true,
              captured_at: "2024-06-01T15:00:00Z",
            },
            {
              ...base,
              registration_number: "2",
              name: "Unknown",
              registration_status: "unknown",
            },
            {
              ...base,
              registration_number: "3",
              name: "Undated retained",
              retained: true,
              captured_at: null,
            },
          ],
        }),
      ),
    );
    const rows = [...container.querySelectorAll(".cm-row:not(.cm-head)")];
    expect(rows[0].textContent).toContain(
      "Last listed in the register copied Jun 1, 2024",
    );
    expect(rows[0].textContent).not.toContain("Oct 28, 2026");
    expect(rows[1].textContent).toContain("Registration status not held");
    expect(rows[1].textContent).not.toContain("Open registration");
    expect(rows[2].textContent).toContain(
      "No longer listed in the current register",
    );
    expect(rows[2].textContent).not.toContain("Last listed");
  });

  it("uses all-held tab counts rather than current-only counts and never invents missing counts", async () => {
    await render("/money", () =>
      json(
        register({
          by_kind: { candidate_committee: 2 },
          held_by_kind: { candidate_committee: 3 },
        }),
      ),
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );
    expect(tabs).toEqual([
      "Candidate committees3",
      "Committees and funds",
      "Party units",
    ]);
  });

  it("sorts the full register on the server and resets paging when the order changes", async () => {
    await render("/money?page=3", () => json(register()));
    const menu = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Sort by:"),
    )!;
    await act(async () => menu.click());
    const registration = [
      ...container.querySelectorAll('[role="option"] button'),
    ].find((b) => b.textContent === "Registration number")!;
    await act(async () => (registration as HTMLButtonElement).click());
    await settle();
    expect(registerRequests().at(-1)).toContain("sort=registration");
    expect(registerRequests().at(-1)).toContain("offset=0");
    expect(window.location.search).toContain("sort=registration");
    expect(window.location.search).not.toContain("page=3");
  });
  it("lists the register with counts, a committee link, a mark and its sources", async () => {
    await render("/money", () => json(register()));
    const text = container.textContent ?? "";
    expect(container.querySelector("h1")?.textContent).toBe("Campaign money");
    expect(registerRequests()[0]).toBe(
      `${API}/api/v1/finance/committees?kind=candidate_committee&limit=50&offset=0&status=all`,
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );
    expect(tabs).toEqual([
      "Candidate committees762",
      "Committees and funds546",
      "Party units299",
    ]);
    expect(text).toContain("1 candidate committee");
    const link = container.querySelector<HTMLAnchorElement>('[role="cell"] a');
    expect(link?.textContent).toBe("Hortman (Melissa) Campaign Committee");
    expect(link?.getAttribute("href")).toBe(
      "/money/committees/18135?from=%2Fmoney",
    );
    expect(
      container.querySelector('[role="cell"] .f-mark-committee'),
    ).not.toBeNull();
    expect(text).toContain("Candidate committee");
    expect(text).toContain("18135");
    expect(container.querySelector(".cm-pager")).toBeNull();
    // The Sources group holds a 2-sentence line, so every line ends with a period.
    expect(text).toContain("Register copied Oct 28, 2026.");
    expect(text).toContain(
      "Minnesota’s payment files copied Oct 9,\u00a02026; report totals copied Oct 28,\u00a02026. These are copy dates, not reporting periods.",
    );
    expect(container.querySelector("#cm-about")?.textContent).toBe(
      "About these records",
    );
    expect(text).toContain(
      "Campaign payment records before 2015 are not included.",
    );
    expect(text).toContain("Open registration");
    // The drawn header action opens Money connections, returning here.
    const connections = container.querySelector(
      'a[href^="/money/connections"]',
    );
    expect(connections?.getAttribute("href")).toBe(
      "/money/connections?from=%2Fmoney",
    );
    expect(connections?.textContent).toContain("Explore money connections");
    expect(
      container.querySelector('a[href^="/money/recipients"]'),
    ).toBeTruthy();
    // Donors by employer is entered from here (Round 29, eug-44), not from Home.
    const employers = container.querySelector('a[href^="/money/employers"]');
    expect(employers?.getAttribute("href")).toBe(
      "/money/employers?from=%2Fmoney",
    );
    expect(employers?.textContent).toContain("Donors by employer");
    expect(employers?.textContent).toContain(
      "Find donors by the employer name reported in their filings.",
    );
    const race = container.querySelector('a[href^="/money/races/"]');
    expect(race?.getAttribute("href")).toBe("/money/races/house?from=%2Fmoney");
    expect(race?.textContent).toContain("Money by race");
    expect(race?.textContent).toContain(
      "Candidate committees and outside spending for one office, district and year, kept distinct.",
    );
    // The shared scrolling tab row (Round 35) holds the directory tabs.
    expect(
      container.querySelector('.f-scroll-tabs [role="tablist"]'),
    ).not.toBeNull();
    expect(text).toContain("Search by name or registration number");
    expect(text).not.toMatch(/illustrative|example|sample|fixture|demo/i);
  });

  it("prints each registration’s own status from the register", async () => {
    await render("/money", () =>
      json(
        register({
          committees: [
            {
              ...register().committees[0],
              registration_number: "1",
              name: "Closed Committee",
              is_closed: true,
              termination_date: "2026-07-28",
            },
            {
              ...register().committees[0],
              registration_number: "2",
              name: "Closed Undated",
              is_closed: true,
              termination_date: null,
            },
            register().committees[0],
          ],
          page: { limit: 50, offset: 0, has_more: false, total: 3 },
        }),
      ),
    );
    const statuses = [...container.querySelectorAll(".cm-status")].map(
      (cell) => cell.textContent,
    );
    expect(statuses).toEqual([
      "Terminated Jul 28, 2026",
      "Terminated",
      "Open registration",
    ]);
    expect(
      [...container.querySelectorAll('[role="columnheader"]')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["NAME", "TYPE", "REGISTRATION NUMBER", "REGISTRATION STATUS"]);
  });

  it("honours ?tab=party and ?tab=committees from Finance Home", async () => {
    await render("/money?tab=party&from=%2Fhome", () =>
      json(
        register({
          committees: [],
          page: { limit: 50, offset: 0, has_more: false, total: 0 },
        }),
      ),
    );
    expect(registerRequests()[0]).toContain("kind=party_unit");
    expect(
      container.querySelector('[aria-selected="true"]')?.textContent,
    ).toContain("Party units");
    // A top-level destination: the nav reaches it, so no return link (settled wording row 17).
    expect(container.querySelector(".f-back")).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    requests = [];
    await render("/money?tab=committees", () => json(register()));
    expect(registerRequests()[0]).toContain("kind=political_committee_or_fund");
  });

  it("updates and clears search as you type while keeping filters", async () => {
    await render("/money?party=DFL&reg=open&page=2&q=before", () =>
      json(register()),
    );
    const input = container.querySelector<HTMLInputElement>("#money-name")!;
    async function enter(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
    }
    vi.useFakeTimers();
    try {
      await enter("Example");
      const params = new URLSearchParams(window.location.search);
      expect(params.get("q")).toBe("Example");
      expect(params.get("party")).toBe("DFL");
      expect(params.get("reg")).toBe("open");
      expect(params.get("page")).toBe("2");
      expect(registerRequests().at(-1)).toContain("q=Example");
      await enter("");
      expect(new URLSearchParams(window.location.search).has("q")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches registered names on the server and keeps payments apart", async () => {
    await render("/money?q=caucus", () => json(register()));
    expect(registerRequests()[0]).toContain("q=caucus");
    expect(container.querySelector(".cm-name-search p")?.textContent).toBe(
      "Payments recorded under that spelling are a separate search",
    );
    expect(container.querySelector(".cm-payments-note")?.textContent).toBe(
      "Every campaign and outside-spending payment, grouped by exact spelling",
    );
    const paymentLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/money/names/"]',
    );
    expect(paymentLinks).toHaveLength(1);
    expect(new URL(paymentLinks[0].href).pathname).toBe("/money/names/caucus");
    expect(new URL(paymentLinks[0].href).searchParams.get("from")).toBe(
      "/money?q=caucus",
    );
    expect(container.querySelector(".cm-aside")?.textContent).not.toContain(
      "Payments under a name",
    );
    expect(container.textContent).toContain("Payments under a name");
  });

  it("keeps earlier registrations labelled with their own search if a new search fails", async () => {
    const finishes: Array<(response: Response) => void> = [];
    await render(
      "/money?q=Hortman&view=candidates&spage_candidates=2",
      (url) =>
        url.includes("q=Other")
          ? new Promise<Response>((resolve) => {
              finishes.push(resolve);
            })
          : json(
              register({
                page: { limit: 50, offset: 50, has_more: true, total: 150 },
              }),
            ),
    );
    const input = container.querySelector<HTMLInputElement>("#money-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Other");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(container.textContent).toContain("Matching “Hortman”");
    expect(container.textContent).toContain(
      "Payments recorded under that spelling are a separate search",
    );
    expect(container.textContent).not.toContain(
      "Registrations matching “Other”",
    );
    await act(async () =>
      finishes.forEach((finish) => finish(new Response("", { status: 503 }))),
    );
    await settle();
    expect(container.textContent).toContain("Matching “Hortman”");
    expect(container.textContent).toContain("Try again");
    expect(container.textContent).not.toContain(
      "Registrations matching “Other”",
    );
    expect(container.textContent).toContain("Page 2 of 3");
    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Next",
    )!;
    expect(next.getAttribute("aria-disabled")).toBe("true");
    await act(async () => next.click());
    expect(window.location.search).toBe("?q=Other&view=candidates");
  });

  it("pages on the server and writes the page to the address", async () => {
    await render("/money", () =>
      json(
        register({
          page: { limit: 50, offset: 0, has_more: true, total: 120 },
        }),
      ),
    );
    expect(container.textContent).toContain("Page 1 of 3");
    const next = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Next",
    )!;
    await act(async () => next.click());
    await settle();
    expect(window.location.search).toBe("?page=2");
    expect(registerRequests().at(-1)).toContain("offset=50");
  });

  it("shows one all-empty result with the registration search hint", async () => {
    await render("/money?q=zzzz", () =>
      json(
        register({
          committees: [],
          page: { limit: 50, offset: 0, has_more: false, total: 0 },
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("No matches for “zzzz”");
    expect(text).toContain("Try a full or partial name or registration number");
    expect(container.querySelector('[role="table"]')).toBeNull();
    expect(container.querySelector(".cm-pager")).toBeNull();
  });

  it("says a failed load is our problem and offers Try again", async () => {
    let fail = true;
    await render("/money", () =>
      fail ? new Response("", { status: 500 }) : json(register()),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn’t load results. This is a problem on our side and says nothing about who is registered.",
    );
    fail = false;
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(
      "Hortman (Melissa) Campaign Committee",
    );
  });

  it("treats an unavailable register as a failure, never as nobody registered", async () => {
    await render("/money", () =>
      json(
        register({
          state: "unavailable",
          committees: [],
          page: { limit: 50, offset: 0, has_more: false, total: null },
          by_kind: null,
          reason: "no_filings_snapshot",
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No matching records");
  });

  it("keeps the last list when a later read answers unavailable", async () => {
    await render("/money", (url) =>
      url.includes("kind=party_unit")
        ? json(
            register({
              state: "unavailable",
              committees: [],
              page: { limit: 50, offset: 0, has_more: false, total: null },
              by_kind: null,
              reason: "no_filings_snapshot",
            }),
          )
        : json(register()),
    );
    const party = [
      ...container.querySelectorAll('[role="tab"]'),
    ][2] as HTMLButtonElement;
    await act(async () => party.click());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    // The outage is a failure with Try again; the earlier rows stay on screen.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain(
      "Hortman (Melissa) Campaign Committee",
    );
  });

  it("keeps earlier results while updating and when an update fails", async () => {
    let release: (value: Response) => void = () => {};
    await render("/money", (url) =>
      url.includes("kind=party_unit")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : json(register()),
    );
    const party = [
      ...container.querySelectorAll('[role="tab"]'),
    ][2] as HTMLButtonElement;
    await act(async () => party.click());
    expect(container.textContent).toContain("Updating results…");
    expect(container.textContent).toContain(
      "Hortman (Melissa) Campaign Committee",
    );
    // The kept rows keep their own count noun, never the new tab's.
    expect(container.querySelector(".cm-count")?.textContent).toBe(
      "1 candidate committee",
    );
    await act(async () => release(new Response("", { status: 503 })));
    await settle();
    expect(container.textContent).toContain(
      "Couldn’t update results. Previous results are shown.",
    );
    expect(container.textContent).toContain(
      "Hortman (Melissa) Campaign Committee",
    );
  });

  it("shows loading rows before the first answer", async () => {
    await render("/money", () => new Promise<Response>(() => {}));
    expect(container.querySelector(".f-skeleton")).not.toBeNull();
  });
});

describe("Campaign money helpers", () => {
  it("reads the address safely", () => {
    expect(tabFromParam("party")).toBe("party");
    expect(tabFromParam("nonsense")).toBe("candidates");
    expect(pageFromParam("3")).toBe(3);
    expect(pageFromParam("-2")).toBe(1);
    expect(pageFromParam("abc")).toBe(1);
  });

  it("builds the server read for a tab, name and page", () => {
    expect(registerPath("committees", "Example Fund", 2)).toBe(
      "finance/committees?kind=political_committee_or_fund&limit=50&offset=50&q=Example+Fund&status=all",
    );
  });

  it("counts with the register nouns and never invents a count", () => {
    expect(countLine("party", 299)).toBe("299 party units");
    expect(countLine("committees", 1)).toBe("1 committee or fund");
    expect(countLine("candidates", 1234)).toBe("1,234 candidate committees");
    expect(countLine("candidates", null)).toBeNull();
    expect(pageCount(0)).toBe(1);
    expect(pageCount(101)).toBe(3);
  });

  it("leaves out a date the server did not serve", () => {
    expect(sourceGroups(null, null)).toEqual([]);
    expect(sourceGroups(register(), null)[0].items).toEqual([
      "Register copied Oct 28, 2026",
    ]);
    const split = sourceGroups(register(), {
      freshness: {
        payment_copied_at: {
          contributions: "2026-10-28T17:39:35Z",
          expenditures: "2026-10-09T21:05:10Z",
          independent_expenditures: null,
        },
        register_fetched_at: null,
      },
    })[0].items;
    // The report-totals line has 2 sentences, so the whole group takes periods.
    expect(split).toContain("Register copied Oct 28, 2026.");
    expect(split).toContain("Contributions file copied Oct 28,\u00a02026.");
    expect(split).toContain("Spending file copied Oct 9,\u00a02026.");
    expect(split).toContain("Outside-spending file copy date unavailable.");
  });

  it("punctuates a Sources group by its sentence count and reads a status", () => {
    expect(punctuateGroup(["Register copied Oct 28, 2026"])).toEqual([
      "Register copied Oct 28, 2026",
    ]);
    expect(
      punctuateGroup(["Register copied Oct 28, 2026", "Copied. Not a period."]),
    ).toEqual(["Register copied Oct 28, 2026.", "Copied. Not a period."]);
    expect(
      registrationStatus({ is_closed: null, termination_date: null }),
    ).toEqual({
      text: "Registration status not held",
      state: "unknown",
    });
    expect(
      registrationStatus({ is_closed: true, termination_date: "2026-01-02" })
        .text,
    ).toBe("Terminated Jan 2, 2026");
  });
});
