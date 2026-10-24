import { timingSafeEqual } from "node:crypto";
import { googleSearchIdentity } from "./traffic-google";
import {
  bingSearchExport,
  providerFailureReason,
  googleSearchExport,
  type SearchView,
} from "./_lib/searchMeasurement";

type RequestLike = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

// The production weekly schedule is installed after included capacity is verified.
// The route works immediately once its two narrow credentials are configured.
// vercel.json caps this Node function at 180 seconds.

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).send(JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  const secret = process.env.CRON_SECRET || "";
  const raw = request.headers?.authorization;
  const authorization = typeof raw === "string" ? raw : "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorization);
  if (
    secret.length < 32 ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    response
      .status(401)
      .send(
        JSON.stringify({ error: "Scheduled measurement access required." }),
      );
    return;
  }
  const writeToken = process.env.SEARCH_MEASUREMENT_WRITE_TOKEN || "";
  const origin = process.env.EXPO_PUBLIC_API_URL || "https://api.alethical.com";
  let trustedOrigin = false;
  try {
    trustedOrigin = new URL(origin).origin === "https://api.alethical.com";
  } catch {
    /* malformed configuration must fail before any provider call */
  }
  // Never send a private payload or write credential to a caller-chosen destination.
  if (
    writeToken.length < 32 ||
    writeToken === secret ||
    !trustedOrigin ||
    process.env.VERCEL_ENV !== "production"
  ) {
    response
      .status(503)
      .send(JSON.stringify({ error: "Private storage is not configured." }));
    return;
  }
  const now = new Date();
  let google: { siteUrl: string; accessToken: string } | null = null;
  try {
    google = await googleSearchIdentity();
  } catch {
    /* fixed failure record below */
  }
  const outcomes: Array<{
    provider: string;
    view: SearchView;
    status: string;
  }> = [];
  const jobs: Array<{ provider: "google" | "bing"; view: SearchView }> = [
    { provider: "google", view: "queries" },
    { provider: "google", view: "pages" },
    { provider: "google", view: "query-pages" },
    { provider: "bing", view: "queries" },
    { provider: "bing", view: "pages" },
  ];
  for (const job of jobs) {
    let payload: unknown = null;
    let status = "unavailable";
    try {
      if (job.provider === "google") {
        if (!google) throw new Error("Identity unavailable");
        payload = await googleSearchExport(
          google.siteUrl,
          google.accessToken,
          { view: job.view, days: 30 },
          now,
        );
      } else {
        const site = process.env.BING_WEBMASTER_SITE_URL;
        const key = process.env.BING_WEBMASTER_API_KEY;
        if (!site || !key) throw new Error("Settings unavailable");
        payload = await bingSearchExport(
          site,
          key,
          { view: job.view, days: 30 },
          now,
        );
      }
      status = "success";
    } catch (error) {
      // Provider errors are unknown, never zero; only a fixed reason label is logged.
      console.error(
        `Search export failed: ${job.provider} ${job.view}: ${providerFailureReason(error)}`,
      );
    }
    try {
      const stored = await fetch(
        "https://api.alethical.com/internal/v1/search-measurements",
        {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-Search-Measurement-Token": writeToken,
          },
          body: JSON.stringify({
            ...job,
            status,
            fetched_at: now.toISOString(),
            payload,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!stored.ok) throw new Error("Storage unavailable");
      outcomes.push({ ...job, status });
    } catch {
      outcomes.push({ ...job, status: "storage-unavailable" });
    }
  }
  const ok = outcomes.every((outcome) => outcome.status === "success");
  response
    .status(ok ? 200 : 503)
    .send(JSON.stringify({ fetchedAt: now.toISOString(), outcomes }));
}
