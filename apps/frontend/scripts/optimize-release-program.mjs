import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { minify } from 'terser';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bundleDirectory = resolve(scriptDirectory, '../dist/_expo/static/js/web');

/** The one file every page loads first. The rest are per-screen pieces (#1966). */
const ENTRY_FILE = /^index-[^/]+\.js$/;

export async function optimizeReleaseProgram(source) {
  const result = await minify(source, {
    compress: {
      passes: 2,
      reduce_funcs: true,
    },
    mangle: true,
    format: {
      ascii_only: true,
      comments: false,
    },
  });

  if (!result.code) {
    throw new Error('The final website-program optimizer returned no code.');
  }

  return result.code;
}

/**
 * Every file the release ships, smallest it can be made.
 *
 * A file the optimizer cannot shrink is left exactly as the build wrote it, so a
 * small screen piece that is already at its smallest is not a build failure. At
 * least one file must shrink: if none does, the optimizer itself is broken and
 * the release would silently ship a megabyte it did not need to.
 */
export async function optimizeReleaseFiles(files, { read, write }) {
  const entries = files.filter((file) => ENTRY_FILE.test(file));
  if (entries.length !== 1) {
    throw new Error(
      `Expected 1 first-loaded web JavaScript file, found ${entries.length}: ${files.join(', ')}`,
    );
  }

  const results = [];
  for (const file of files) {
    const source = await read(file);
    const optimized = await optimizeReleaseProgram(source);
    const sourceBytes = Buffer.byteLength(source);
    const optimizedBytes = Buffer.byteLength(optimized);

    if (optimizedBytes >= sourceBytes) {
      results.push({ file, sourceBytes, optimizedBytes, written: false });
      continue;
    }

    // Parse the complete result before replacing the release file. This catches a
    // truncated or malformed optimizer result without running browser-only code.
    new Function(optimized);
    await write(file, optimized);
    results.push({ file, sourceBytes, optimizedBytes, written: true });
  }

  if (!results.some((result) => result.written)) {
    throw new Error('Final website-program optimization shrank no file.');
  }

  return results;
}

async function optimizeBuiltReleaseProgram() {
  const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

  const results = await optimizeReleaseFiles(bundleFiles, {
    read: (file) => readFile(resolve(bundleDirectory, file), 'utf8'),
    write: (file, code) => writeFile(resolve(bundleDirectory, file), code),
  });

  for (const result of results) {
    console.log(
      result.written
        ? `Release program optimized: ${result.file} (${result.sourceBytes} -> ${result.optimizedBytes} bytes)`
        : `Release program already smallest: ${result.file} (${result.sourceBytes} bytes)`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await optimizeBuiltReleaseProgram();
}
