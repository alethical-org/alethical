import { readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

if (bundleFiles.length !== 1) {
  throw new Error(
    `Expected 1 web JavaScript bundle, found ${bundleFiles.length}: ${bundleFiles.join(', ')}`,
  );
}

console.log(`Release asset check passed: ${bundleFiles[0]}`);
