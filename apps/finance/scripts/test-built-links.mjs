// Proves each rule in check-built-links.mjs fires, and stays quiet on what Finance may
// ship: its own addresses, email contacts, the data service and server paths.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alethicalRouteSegments,
  builtLinkProblems,
  financePatterns,
} from './check-built-links.mjs';

const options = { segments: alethicalRouteSegments(), patterns: financePatterns() };
const check = (name, text) => builtLinkProblems([{ name, text }], options);

test("reads alethical.com's page routes and Finance's own addresses from their code", () => {
  for (const segment of ['money', 'bills', 'legislators', 'blog']) {
    assert.ok(options.segments.has(segment), segment);
  }
  assert.ok(options.patterns.includes('/money/committees/:id'));
});

test('fails on the alethical.com domain in any shipped text file', () => {
  assert.equal(check('dist/a.js', 'const o="https://www.alethical.com";').length, 1);
  assert.equal(check('dist/index.html', '<a href="https://alethical.com/money">x</a>').length, 1);
  assert.equal(
    check('dist/robots.txt', 'Sitemap: https://www.Alethical.com/sitemap.xml').length,
    1,
  );
});

test('fails on a path-only link to an alethical.com page', () => {
  const problems = check(
    'dist/a.js',
    'const a=`/legislators/${id}`, b="/money/lobbying?q="+q, c=`/bills/`, d="/blog/research";',
  );
  assert.deepEqual(
    problems.map((problem) => problem.split(': ').pop()),
    ['/legislators/', '/money/lobbying', '/bills/', '/blog/research'],
  );
  assert.equal(check('dist/index.html', '<a href="/blog/guides">Guides</a>').length, 1);
});

test("passes Finance's own addresses, contacts, the data service and server paths", () => {
  const text = [
    'const r=[{pattern:"/money/committees/:id"},{pattern:"/bills"},{pattern:"/sign-in"}];',
    'const m="mailto:ask@alethical.com", api=`https://api.alethical.com/api/v1/x`;',
    'const s=`${authUrl}/admin/users`, t=`${base}/bills/${id}`, f=`/auth/return?x=${y}`;',
  ].join('\n');
  assert.deepEqual(check('dist/a.js', text), []);
  assert.deepEqual(check('dist/a.js.map', '"https://www.alethical.com"'), []);
  assert.deepEqual(check('dist/a.css', '@font-face{src:url(/fonts/inter.woff2)}'), []);
});
