import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';

/**
 * Compressed bytes for exactly the program files named by the built HTML.
 *
 * The production web export keeps shared screen code with the screens that need
 * it, so its HTML names 1 index file containing the startup program and runtime.
 * Read the HTML rather than assuming a file count. Later screen and details
 * downloads are measured separately in real browser checks.
 *
 * Set this ratchet from Vercel's hosted production build, never a local export,
 * even when the local export includes production settings. Lower it with a
 * measured reduction; raise it only with a hosted measurement and a reason.
 *
 * Vercel measured 338,333 bytes for committed source a30d7941 on 13 September
 * 2026 (deployment dpl_2wadpZBF3EsRdzsM97axhR8FuBsE, production target without
 * the public domain). The 339,072 limit leaves the existing 739-byte headroom.
 * The dated measurements and release contract live
 * in docs/operations/page-load-performance-decisions.md.
 *
 * https://github.com/alethical-org/alethical/issues/2012
 * https://github.com/alethical-org/alethical/issues/2052
 */
export const FIRST_LOAD_LIMIT = 339072;

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
 * screen or later details that need it.
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

/** Diagnostic only: a settings-less build cannot establish production headroom.
 * A fixed adjustment is not a measurement. On the same source in September 2026,
 * hosted preview was 338,978 bytes and hosted production was 338,820 bytes; the
 * former +542 estimate falsely rejected the preview as 339,520. Every build now
 * enforces its own actual bytes. Production must pass its own hosted check.
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
  if (total > limit) {
    const lines = measured
      .sort((a, b) => b.bytes - a.bytes)
      .map((file) => `  ${String(file.bytes).padStart(8)}  ${file.name}`)
      .join('\n');
    const settingsNote = carriesItsSettings
      ? ''
      : '\nThis build inlined no settings. Its size does not establish production headroom.';
    throw new Error(
      `Every reader now downloads ${total} bytes before this app can draw, over the ${limit}-byte limit by ${total - limit}.${settingsNote}\n${lines}\n` +
        'Move what a first page does not need into the screen that needs it, or raise the limit in ' +
        'apps/frontend/scripts/check-first-load-budget.mjs from Vercel’s hosted production measurement, ' +
        'never from a local build, even one with production settings.',
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
  console.log(
    `First-load budget passed: ${total} bytes of ${FIRST_LOAD_LIMIT} across ${files.length} files ` +
      `(${measured.map((f) => `${f.name.split('-')[0]} ${f.bytes}`).join(', ')})` +
      (carriesItsSettings
        ? ' — settings are included. Only Vercel’s hosted production measurement may set the limit.'
        : '\n  This build inlined no settings. No fixed adjustment predicts production size. ' +
          'A hosted production build must pass its own measured size; never move the limit from this run.'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkBuiltFirstLoad();
}
