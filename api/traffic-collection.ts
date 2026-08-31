type RequestLike = { method?: string; body?: unknown };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

function excludedAccountIds() {
  return new Set(
    (process.env.TRAFFIC_EXCLUDED_ACCOUNT_IDS ?? "")
      .split(",")
      .map((accountId: string) => accountId.trim())
      .filter(Boolean),
  );
}

function requestBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sendJson(response: ResponseLike, status: number, body: object) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.status(status).send(JSON.stringify(body));
}

export default function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = requestBody(request.body);
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    sendJson(response, 400, { error: "A signed-in account is required." });
    return;
  }

  const excluded = excludedAccountIds();
  const teamAccount = excluded.has(userId);
  sendJson(response, 200, {
    collect: !teamAccount,
    teamAccount,
    teamExclusionConfigured: excluded.size > 0,
  });
}
