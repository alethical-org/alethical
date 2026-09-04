import { readdir, readFile } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';

/**
 * How many bytes a reader downloads before this app can draw anything.
 *
 * A page names 3 files in its HTML and cannot start without all 3, so this is
 * what every reader pays on a first visit whatever address they opened. It sat
 * at 598,799 bytes in 1 file until each screen moved into its own download
 * (#1966). Screen files are not counted: a page fetches only its own.
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
export const FIRST_LOAD_LIMIT = 453000;

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

/** The 3 files a page names in its HTML: the entry, the shared parts, the runtime. */
export function firstLoadFiles(files) {
  return files.filter((file) => !/Screen[^/]*\.js$/.test(file) && file.endsWith('.js'));
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
  const files = firstLoadFiles(await readdir(directory));
  if (files.length === 0) {
    throw new Error('The web build named no first-loaded JavaScript file.');
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
