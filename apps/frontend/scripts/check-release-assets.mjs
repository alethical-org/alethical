import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));
// One file every page loads first, then a piece per screen (#1966).
const entryFiles = bundleFiles.filter((file) => /^index-[^/]+\.js$/.test(file));

if (entryFiles.length !== 1) {
  throw new Error(
    `Expected 1 first-loaded web JavaScript file, found ${entryFiles.length}: ${bundleFiles.join(', ')}`,
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

// The 2 the page ships: `alethical-history-entry`, which gives this history entry
// its identifier before Cloudflare's speed beacon can mistake the call for a reader
// clicking a link (issue 2336), and `alethical-release-recovery`, which reloads a tab
// left open across a release. A third would be an unreviewed program on every page.
const EXPECTED_INLINE_PROGRAMS = 2;

if (inlinePrograms.length !== EXPECTED_INLINE_PROGRAMS) {
  throw new Error(
    `Expected ${EXPECTED_INLINE_PROGRAMS} built inline programs, found ${inlinePrograms.length}.`,
  );
}

console.log(
  `Release asset check passed: ${entryFiles[0]} and ${bundleFiles.length - 1} screen pieces`,
);
