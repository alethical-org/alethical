import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';

/**
 * How many bytes a reader downloads before this app can draw anything.
 *
 * A page names 3 files in its HTML and cannot start without all 3, so this is
 * what every reader pays on a first visit whatever address they opened. It sat
 * at 598,799 bytes in 1 file until each screen moved into its own download
 * (#1966), and at 451,044 until everything sign-in followed, the client that
 * talks to the sign-in service included (#1976). Only the files the built page
 * names count: everything else is fetched later by the part that needs it.
 *
 * The limit is a ratchet set just above what the build actually produces, not a
 * target to grow into. It exists so the number cannot quietly grow back, which
 * is how it reached 598,799 unnoticed. Lower it whenever a change lands under
 * it; raise it only with a measurement and a reason, in the same change that
 * makes the file bigger.
 *
 * `docs/operations/page-load-performance-decisions.md` § Each screen downloads
 * with its own route holds the measurements and the floor this cannot go below.
 */
// The private account list stays in its screen chunk. The combined account and
// SEO release measures 389,521 bytes in Vercel's build, leaving 479 bytes here.
// Keep this tied to the hosted result, since local configuration changes size.
//
// **Measure this on Vercel, never on a laptop, and the gap is 542 bytes.** A local
// build of commit 01ffcbb0 produced 390,219 bytes where Vercel's build of that same
// commit produced 390,761, all of it in `index-*.js`, whose content hash differs
// between the 2 because the build inlines configuration a laptop does not hold. A
// ratchet set from the smaller number is a ratchet the hosted build then fails, and
// a failed build does not deploy: production served no merge for 50 minutes on
// 8 Sep 2026 while 4 commits sat merged and unshipped, the first of them the very
// change that had just moved this limit from a local reading
// ([issue 2052](https://github.com/alethical-org/alethical/issues/2052)).
//
// So the figure here is Vercel's own: 390,761 bytes for 01ffcbb0, plus 739 for the
// next change to spend, which is more than the measured gap so a hosted build cannot
// fail a limit a local build passed by a whisker.
//
// What the bytes above 390,000 buy, and what was done before spending them. The
// end-to-end freshness deadline (issue 2023) is a bound on how old a claim naming a
// real person can be by the time somebody reads it, which was previously unbounded
// for an open tab. Before that limit moved, the 2 withheld sentences moved into the
// 2 screens that draw them (`lib/committeeMoney.ts`,
// `lib/legislatorCampaignMoney.ts`), taking 475 bytes off every page that will never
// print them; and folding the age-reading fetch helper into `publicApiRequest` made
// the first load 409 bytes BIGGER, because that function has dozens of callers and
// the wrapper's returned object inlines into each, so the duplication in
// `data/api.ts` is deliberate and its comment says so.
export const FIRST_LOAD_LIMIT = 391500;

/**
 * The exact settings Vercel compresses with, so this reports the bytes a reader
 * really receives rather than the smallest the file could be.
 *
 * Found by compressing files downloaded from production and comparing: on
 * 4 Sep 2026 Vercel sent the 1,579,465-byte program as 417,940 bytes, the shared
 * file as 36,718 and a screen file as 3,712, and quality 3 with a 19-bit window
 * reproduced all 3 to the byte. Quality 4 would report 404,414 for that program
 * and quality 11 would report 341,813, flattering a release by 3% and 18%.
 */
export function productionBytes(source) {
  return brotliCompressSync(Buffer.from(source), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 3,
      [constants.BROTLI_PARAM_LGWIN]: 19,
    },
  }).length;
}

/**
 * The files a page names in its own HTML, read from that HTML.
 *
 * These are what a reader waits on: the browser will not run the app until all
 * of them have arrived. Everything else in the build is fetched later, by the
 * screen that needs it, and a reader downloads at most 1 of those per page.
 *
 * Read rather than guessed. This used to keep every built file whose name did
 * not end in `Screen*.js`, which charged a reader for files no page names: the
 * probe in #1976 made the sign-in dialog arrive on demand and the check counted
 * its 8,538 bytes and the email-link page's 3,991 as if every reader downloaded
 * both, reporting 451,647 where a reader really received 439,118.
 */
export function firstLoadFiles(html) {
  return [...html.matchAll(/<script\s+src="\/_expo\/static\/js\/web\/([^"]+\.js)"/g)].map(
    (match) => match[1],
  );
}

export function checkFirstLoadBudget(measured, limit = FIRST_LOAD_LIMIT) {
  const total = measured.reduce((sum, file) => sum + file.bytes, 0);
  if (total > limit) {
    const lines = measured
      .sort((a, b) => b.bytes - a.bytes)
      .map((file) => `  ${String(file.bytes).padStart(8)}  ${file.name}`)
      .join('\n');
    throw new Error(
      `Every reader now downloads ${total} bytes before this app can draw, over the ${limit}-byte limit by ${total - limit}.\n${lines}\n` +
        'Move what a first page does not need into the screen that needs it, or raise the limit in ' +
        'apps/frontend/scripts/check-first-load-budget.mjs with the measurement that justifies it.',
    );
  }
  return total;
}

async function checkBuiltFirstLoad() {
  const directory = new URL('../dist/_expo/static/js/web/', import.meta.url);
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const files = firstLoadFiles(html);
  if (files.length === 0) {
    throw new Error('The built page names no JavaScript file.');
  }

  const measured = [];
  for (const name of files) {
    measured.push({ name, bytes: productionBytes(await readFile(new URL(name, directory))) });
  }
  const total = checkFirstLoadBudget(measured);
  console.log(
    `First-load budget passed: ${total} bytes of ${FIRST_LOAD_LIMIT} across ${files.length} files ` +
      `(${measured.map((f) => `${f.name.split('-')[0]} ${f.bytes}`).join(', ')})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkBuiltFirstLoad();
}
