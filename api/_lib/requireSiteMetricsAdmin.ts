type RequestLike = { headers?: Record<string, string | string[] | undefined> };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

/** Check the same administrator permission used by the private Railway screens. */
export async function requireSiteMetricsAdmin(
  request: RequestLike,
  response: ResponseLike,
): Promise<boolean> {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Vary", "Authorization");
  const raw = request.headers?.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  if (!authorization || !/^Bearer \S+$/.test(authorization)) {
    response.status(401).send(JSON.stringify({ error: "Sign in required." }));
    return false;
  }

  const origin = (
    process.env.EXPO_PUBLIC_API_URL || "https://api.alethical.com"
  ).replace(/\/$/, "");
  try {
    const access = await fetch(`${origin}/api/v1/admin/access`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (access.status === 401 || access.status === 403) {
      response
        .status(access.status)
        .send(JSON.stringify({ error: "Administrator access required." }));
      return false;
    }
    if (!access.ok) throw new Error("Access check failed");
    const body: unknown = await access.json();
    const allowed =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      body.data !== null &&
      typeof body.data === "object" &&
      "is_admin" in body.data &&
      body.data.is_admin === true;
    if (!allowed) {
      response
        .status(403)
        .send(JSON.stringify({ error: "Administrator access required." }));
      return false;
    }
    return true;
  } catch {
    response.setHeader("X-Site-Metrics-Access", "unavailable");
    response
      .status(503)
      .send(
        JSON.stringify({ error: "Access check is temporarily unavailable." }),
      );
    return false;
  }
}
