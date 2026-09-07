import type { BrowserContext } from '@playwright/test';

/** Install before opening a page. Browser checks must never become reader
 * activity. Routes intercept delivery locally, including keepalive requests. */
export async function suppressSiteMetrics(context: BrowserContext) {
  await context.route('**/_vercel/insights/**', (route) => route.abort());
  await context.route('**/api/v1/site-metrics/events', (route) => route.fulfill({ status: 204 }));
}
