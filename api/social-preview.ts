import {
  buildAnswerShareContent,
  buildBillShareContent,
  buildLegislatorShareContent,
  publicPageUrl,
  renderSocialPreviewHtml,
  type ShareContent,
} from "../apps/frontend/src/lib/share";

type QueryValue = string | string[] | undefined;
type RequestLike = { query?: Record<string, QueryValue> };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type BillPayload = {
  id?: string;
  title?: string;
  ai_analysis?: { short_title?: string | null; summary?: string | null } | null;
};

type LegislatorPayload = {
  full_name?: string;
  current_service?: {
    chamber?: string;
    party?: string | null;
    district?: { code?: string } | null;
  } | null;
};

const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL || "https://api.alethical.com"
).replace(/\/$/, "");

function one(value: QueryValue): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function billIdentifier(id: string): string {
  const match = id.match(/-(SF|HF)(\d+)$/i);
  return match ? `${match[1]?.toUpperCase()} ${match[2]}` : id;
}

function titleCase(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "";
}

function partyName(value: string | null | undefined): string {
  const party = (value || "").toUpperCase();
  if (party === "DFL" || party === "D") return "Democratic-Farmer-Labor";
  if (party === "R" || party === "REPUBLICAN") return "Republican";
  return "Independent";
}

function officialName(name: string, chamber: string): string {
  const bare = name
    .replace(/^(sen\.|senator|rep\.|representative)\s+/i, "")
    .trim();
  if (chamber === "Senate") return `Sen. ${bare}`;
  if (chamber === "House") return `Rep. ${bare}`;
  return bare;
}

async function getApiData<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

function answerUrl(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const key of ["q", "bill", "legislator", "suggestion"] as const) {
    const value = one(query[key]);
    if (value) params.set(key, value);
  }
  const serialized = params.toString();
  return publicPageUrl(serialized ? `/ask?${serialized}` : "/ask");
}

async function previewContent(
  query: Record<string, QueryValue>,
): Promise<ShareContent> {
  const subject = one(query.subject);

  if (subject === "bill") {
    const id = one(query.id);
    const url = publicPageUrl(`/bills/${encodeURIComponent(id)}`);
    try {
      const bill = await getApiData<BillPayload>(
        `/bills/${encodeURIComponent(id)}?include=ai_analysis`,
      );
      return buildBillShareContent({
        identifier: billIdentifier(bill.id || id),
        title: bill.ai_analysis?.short_title || bill.title || "Minnesota bill",
        summary: bill.ai_analysis?.summary,
        url,
      });
    } catch {
      return buildBillShareContent({
        identifier: billIdentifier(id),
        title: "Minnesota bill",
        summary: null,
        url,
      });
    }
  }

  if (subject === "legislator") {
    const id = one(query.id);
    const url = publicPageUrl(`/legislators/${encodeURIComponent(id)}`);
    try {
      const legislator = await getApiData<LegislatorPayload>(
        `/legislators/${encodeURIComponent(id)}?include=current_service`,
      );
      const chamber = titleCase(legislator.current_service?.chamber || "");
      const district = legislator.current_service?.district?.code || "Unknown";
      return buildLegislatorShareContent({
        displayName: officialName(
          legislator.full_name || "Minnesota legislator",
          chamber,
        ),
        partyLabel: partyName(legislator.current_service?.party),
        districtLine: chamber
          ? `${chamber} District ${district}`
          : `District ${district}`,
        url,
      });
    } catch {
      return {
        subject: "legislator",
        title: "Minnesota legislator profile",
        description:
          "See this legislator’s public record in the Minnesota Legislature.",
        url,
      };
    }
  }

  return buildAnswerShareContent({
    question: one(query.q) || "Alethical answer",
    url: answerUrl(query),
  });
}

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  const content = await previewContent(request.query ?? {});
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=86400",
  );
  response.status(200).send(renderSocialPreviewHtml(content));
}
