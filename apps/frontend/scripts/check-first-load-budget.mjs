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

/**
 * How many more bytes Vercel's build produces than this one, for the same commit.
 *
 * Measured on commit 01ffcbb0, 8 Sep 2026: a settings-less build produced 390,219
 * bytes where Vercel produced 390,761, the whole difference in `index-*.js`.
 *
 * THE CAUSE IS KNOWN AND IT IS THE SETTINGS. A deploying build inlines the 6 public
 * `EXPO_PUBLIC_*` values; a worktree has no `.env` and inlines none. That is only
 * 261 raw bytes of text, and it becomes 1,510 after minification and 542 compressed,
 * because the values are high-entropy strings that compress poorly and shift what
 * the minifier can fold. Node is not involved: the host builds on 24 and a build on
 * 24 here is byte-identical to one on 22.
 *
 * ONE TRAP WHEN RE-MEASURING THIS. Metro caches transforms, so setting the values
 * and rebuilding produces a byte-identical bundle that still contains none of them.
 * It took a fresh cache (an empty `TMPDIR` plus `--clear`) to see the difference at
 * all, and a measurement taken without that read as proof the settings did not
 * matter.
 *
 * WHY THIS IS ADDED RATHER THAN WRITTEN IN A COMMENT. The comment saying to measure
 * on the host existed, was read, was quoted in the commit message that then ignored
 * it, and 4 merges sat unshipped for 50 minutes
 * ([issue 2052](https://github.com/alethical-org/alethical/issues/2052)). Adding it
 * to every unhosted total makes this check answer the question that actually
 * matters, which is not "does my build fit" but "will the build that deploys fit".
 *
 * HONEST LIMIT, because this is one measurement of one commit. It is not a
 * guarantee: a future commit whose gap is larger could still pass here and fail on
 * the host. What it removes is the case that happened, where a local total sat a
 * few bytes under the limit and the hosted total sat over it. Re-measure it the
 * next time a hosted build's own figure is in hand, and raise it if it has grown.
 */
export const HOSTED_BUILD_EXCESS_BYTES = 542;

/**
 * Whether a built program carries the settings a deploying build inlines.
 *
 * ASK THE BUNDLE, NOT THE ENVIRONMENT, and that is the whole correction. This first
 * keyed on `VERCEL=1`, which reads as "is this the host" and is the wrong question:
 * the excess is a property of whether the build HAD its settings, not of where it
 * ran. The main checkout holds a `.env`, so a build there inlines real values and is
 * already the size the host produces; adding the excess there would fail a build
 * that would have deployed. A worktree has no `.env` and is the case it is for.
 *
 * The marker is a Supabase address, because that setting is the one a build meant to
 * deploy cannot work without and the one a worktree never has. Measured 8 Sep 2026:
 * the live program has 1 hit and a worktree's build has 0.
 */
export function firstLoadCarriesItsSettings(programSource) {
  return programSource.includes('.supabase.co');
}

export function checkFirstLoadBudget(
  measured,
  limit = FIRST_LOAD_LIMIT,
  carriesItsSettings = true,
) {
  const total = measured.reduce((sum, file) => sum + file.bytes, 0);
  // A build that inlined no settings is a SMALLER build of the same code, so its own
  // total passing says nothing about the build that deploys.
  const enforced = carriesItsSettings ? total : total + HOSTED_BUILD_EXCESS_BYTES;
  if (enforced > limit) {
    const lines = measured
      .sort((a, b) => b.bytes - a.bytes)
      .map((file) => `  ${String(file.bytes).padStart(8)}  ${file.name}`)
      .join('\n');
    const projected = carriesItsSettings
      ? ''
      : `\nThis build inlined no settings, so it measured ${total}. A build that has them runs ` +
        `about ${HOSTED_BUILD_EXCESS_BYTES} bytes larger, so ${enforced} is what the deploying ` +
        "build's own check will see, and its failure does not deploy.";
    throw new Error(
      `Every reader now downloads ${enforced} bytes before this app can draw, over the ${limit}-byte limit by ${enforced - limit}.${projected}\n${lines}\n` +
        'Move what a first page does not need into the screen that needs it, or raise the limit in ' +
        'apps/frontend/scripts/check-first-load-budget.mjs from the figure a build WITH its settings ' +
        'produced, never from one without them.',
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
  // Read off the built program rather than the environment, so a build is judged by
  // what it actually contains (`firstLoadCarriesItsSettings`).
  const program = files.find((name) => name.startsWith('index-')) ?? files[0];
  const carriesItsSettings = firstLoadCarriesItsSettings(
    await readFile(new URL(program, directory), 'utf8'),
  );
  const total = checkFirstLoadBudget(measured, FIRST_LOAD_LIMIT, carriesItsSettings);
  // The number reported is the one that will be enforced, so a passing line here can
  // never be quoted as headroom the deploying build does not have. That misuse is
  // exactly what set the limit 261 bytes too low on 8 Sep 2026.
  const enforced = carriesItsSettings ? total : total + HOSTED_BUILD_EXCESS_BYTES;
  console.log(
    `First-load budget passed: ${enforced} bytes of ${FIRST_LOAD_LIMIT} across ${files.length} files ` +
      `(${measured.map((f) => `${f.name.split('-')[0]} ${f.bytes}`).join(', ')})` +
      (carriesItsSettings
        ? ' — this build inlined its settings, so this figure is the one to move the limit from.'
        : `\n  This build inlined no settings, so it measured ${total}; the +${HOSTED_BUILD_EXCESS_BYTES} is what a build with them adds. ` +
          "Never move the limit from this run's number."),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkBuiltFirstLoad();
}
