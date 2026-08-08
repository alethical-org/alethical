import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { minify } from 'terser';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bundleDirectory = resolve(scriptDirectory, '../dist/_expo/static/js/web');

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

async function optimizeBuiltReleaseProgram() {
  const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

  if (bundleFiles.length !== 1) {
    throw new Error(
      `Expected 1 web JavaScript bundle, found ${bundleFiles.length}: ${bundleFiles.join(', ')}`,
    );
  }

  const bundlePath = resolve(bundleDirectory, bundleFiles[0]);
  const source = await readFile(bundlePath, 'utf8');
  const optimized = await optimizeReleaseProgram(source);
  const sourceBytes = Buffer.byteLength(source);
  const optimizedBytes = Buffer.byteLength(optimized);

  if (optimizedBytes >= sourceBytes) {
    throw new Error(
      `Final website-program optimization did not shrink the file (${sourceBytes} -> ${optimizedBytes} bytes).`,
    );
  }

  // Parse the complete result before replacing the release file. This catches a
  // truncated or malformed optimizer result without running browser-only code.
  new Function(optimized);
  await writeFile(bundlePath, optimized);

  console.log(
    `Release program optimized: ${bundleFiles[0]} (${sourceBytes} -> ${optimizedBytes} bytes)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await optimizeBuiltReleaseProgram();
}
