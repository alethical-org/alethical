/**
 * One worker of the final website-program optimizer: shrinks the files it is
 * sent, 1 at a time, and reports each result to the main thread. Started by
 * optimize-release-program.mjs; never run on its own.
 */
import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';

import { optimizeReleaseProgram } from './optimize-release-program.mjs';

parentPort.on('message', async ({ path }) => {
  try {
    const source = await readFile(path, 'utf8');
    const optimized = await optimizeReleaseProgram(source);
    parentPort.postMessage({ path, source, optimized });
  } catch (error) {
    parentPort.postMessage({ path, error: error instanceof Error ? error.message : String(error) });
  }
});
