import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

if (bundleFiles.length !== 1) {
  throw new Error(
    `Expected 1 web JavaScript bundle, found ${bundleFiles.length}: ${bundleFiles.join(', ')}`,
  );
}

const releaseHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(
  await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'),
);
const securityPolicy = vercelConfig.headers
  ?.find((rule) => rule.source === '/(.*)')
  ?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;

if (!securityPolicy) {
  throw new Error('The production website has no Content-Security-Policy header.');
}

const inlinePrograms = [
  ...releaseHtml.matchAll(
    /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi,
  ),
];
for (const [, program] of inlinePrograms) {
  const hash = `'sha256-${createHash('sha256').update(program).digest('base64')}'`;
  if (!securityPolicy.includes(hash)) {
    throw new Error(`The production policy does not trust built inline program ${hash}.`);
  }
}

if (inlinePrograms.length !== 1) {
  throw new Error(`Expected 1 built inline program, found ${inlinePrograms.length}.`);
}

console.log(`Release asset check passed: ${bundleFiles[0]}`);
