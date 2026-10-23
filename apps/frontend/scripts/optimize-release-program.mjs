import { readdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

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
export async function optimizeReleaseFiles(files, { read, write, optimize = optimizeEach }) {
  const entries = files.filter((file) => ENTRY_FILE.test(file));
  if (entries.length !== 1) {
    throw new Error(
      `Expected 1 first-loaded web JavaScript file, found ${entries.length}: ${files.join(', ')}`,
    );
  }

  const results = [];
  for (const { file, source, optimized } of await optimize(files, read)) {
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

/** Shrink the files 1 after another in this thread, in the order given. */
async function optimizeEach(files, read) {
  const done = [];
  for (const file of files) {
    const source = await read(file);
    done.push({ file, source, optimized: await optimizeReleaseProgram(source) });
  }
  return done;
}

/**
 * Shrink the files on every processor at once, in the order given.
 *
 * Each file is shrunk by 1 worker thread on its own; the result for a file does
 * not depend on which worker shrank it or when, so the output is the same as the
 * 1-at-a-time path. Shrinking the 60-odd files took about 40 s of a 96 s build on
 * a 4-processor runner when done 1 at a time.
 */
export function optimizeInWorkers(directory, workerCount = Math.min(availableParallelism(), 8)) {
  return (files, read) =>
    new Promise((resolveAll, reject) => {
      const pending = [...files];
      const results = new Map();
      const workers = [];
      const finish = () => {
        for (const worker of workers) void worker.terminate();
      };
      const assign = (worker) => {
        const file = pending.shift();
        if (file === undefined) return;
        worker.postMessage({ path: resolve(directory, file), file });
      };
      for (let index = 0; index < Math.min(workerCount, files.length); index += 1) {
        const worker = new Worker(new URL('./optimize-release-worker.mjs', import.meta.url));
        workers.push(worker);
        worker.on('message', ({ path, source, optimized, error }) => {
          const file = files.find((candidate) => resolve(directory, candidate) === path);
          if (error) {
            finish();
            reject(new Error(`Optimizing ${file} failed: ${error}`));
            return;
          }
          results.set(file, { file, source, optimized });
          if (results.size === files.length) {
            finish();
            resolveAll(files.map((name) => results.get(name)));
            return;
          }
          assign(worker);
        });
        worker.on('error', (error) => {
          finish();
          reject(error);
        });
        assign(worker);
      }
      void read;
    });
}

async function optimizeBuiltReleaseProgram() {
  const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));
  const started = performance.now();
  console.log(
    `Shrinking ${bundleFiles.length} files on ${Math.min(availableParallelism(), 8)} workers (${availableParallelism()} processors)`,
  );

  const results = await optimizeReleaseFiles(bundleFiles, {
    read: (file) => readFile(resolve(bundleDirectory, file), 'utf8'),
    write: (file, code) => writeFile(resolve(bundleDirectory, file), code),
    optimize: optimizeInWorkers(bundleDirectory),
  });

  console.log(`Shrinking took ${Math.round(performance.now() - started)} ms`);
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
