import test from 'node:test';
import assert from 'node:assert/strict';
import { readerBaseUrl, commitSha, readerRequestPolicy } from './reader-completion-policy.mjs';

const base = 'https://www.alethical.com';

test('only official production and bare HTTP loopback origins can be targets', () => {
  for (const value of [
    base,
    'http://localhost:19006',
    'http://127.0.0.1:4173',
    'http://[::1]:4173',
  ]) {
    assert.equal(readerBaseUrl(value), new URL(value).origin);
  }
  for (const value of [
    'https://alethical.com',
    'https://www.alethical.com.evil.test',
    'https://evil.test',
    'https://www.alethical.com/path',
    `${base}?access_token=fake`,
    `${base}#fake`,
    'https://fake:fake@www.alethical.com',
    'file:///tmp/test',
    'http://127.0.0.2:8000',
    'https://localhost:8000',
  ]) {
    assert.throws(() => readerBaseUrl(value));
  }
});

test('unexpected mutation methods and private or paid paths are always denied', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(readerRequestPolicy(`${base}/bills`, method, base), 'deny');
  }
  for (const path of [
    '/auth/callback',
    '/sign-in',
    '/api/v1/me/tracked-bills',
    '/api/v1/ask',
    '/chat',
  ]) {
    assert.equal(readerRequestPolicy(`${base}${path}`, 'GET', base), 'deny');
  }
  for (const suffix of [
    '?access_token=clearly-fake',
    '#code=clearly-fake',
    '?provider-token=clearly-fake',
    '?%zz=fake',
  ]) {
    assert.equal(readerRequestPolicy(`${base}/bills${suffix}`, 'GET', base), 'deny');
  }
});

test('metrics are suppressed locally and public reads have a bounded host list', () => {
  for (const address of [
    `${base}/_vercel/insights/view`,
    `${base}/cdn-cgi/rum`,
    'https://api.alethical.com/api/v1/site-metrics/events',
    'https://cloudflareinsights.com/beacon',
  ]) {
    assert.equal(readerRequestPolicy(address, 'POST', base), 'metrics');
  }
  for (const address of [
    `${base}/bills?q=school`,
    'https://api.alethical.com/api/v1/bills?q=school',
  ]) {
    assert.equal(readerRequestPolicy(address, 'GET', base), 'read');
  }
  assert.equal(
    readerRequestPolicy('https://www.revisor.mn.gov/bills/94/2025/0/HF/719/', 'GET', base),
    'official-source',
  );
  for (const address of [
    'https://evil.test/',
    'https://api.alethical.com/api/v1/ask/answers/id',
    'https://fake:fake@api.alethical.com/api/v1/bills',
    'data:text/html,fake',
    'https://www.revisor.mn.gov/admin',
  ]) {
    assert.equal(readerRequestPolicy(address, 'GET', base), 'deny');
  }
});

test('evidence commit identifiers cannot carry shell words, fragments, or partial hashes', () => {
  assert.equal(commitSha('a'.repeat(40)), 'a'.repeat(40));
  for (const value of ['main', 'abc123', 'a'.repeat(40) + '\n', '$(fake)', null])
    assert.throws(() => commitSha(value));
});

test('rejected targets still save safe failed evidence without exposing the supplied address', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { runReaderChecks } = await import('./reader-completion-checks.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'reader-evidence-'));
  try {
    const output = join(directory, 'result.json');
    const report = await runReaderChecks({
      baseUrl: `${base}/?access_token=clearly-fake-secret`,
      output,
    });
    assert.equal(report.passed, false);
    assert.equal(report.checks[0].name, 'input-safety');
    const saved = await readFile(output, 'utf8');
    assert.equal(saved.includes('clearly-fake-secret'), false);
    assert.equal(saved.includes('access_token'), false);
    assert.equal(saved.includes('callback'), false);
    assert.equal(JSON.parse(saved).checks.length, 1);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('older releases pass only for proven unchanged website paths from pinned release settings', async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const { readerReleaseRelation } = await import('./reader-release-relation.mjs');
  const cwd = await mkdtemp(join(tmpdir(), 'reader-release-history-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Isolated test Git operation must succeed');
    return result.stdout.trim();
  };
  const save = async (file, content) => {
    await writeFile(join(cwd, file), content);
  };
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Reader test',
      '-c',
      'user.email=reader@example.test',
      'commit',
      '-qm',
      'Test',
    );
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    await mkdir(join(cwd, 'apps/frontend'), { recursive: true });
    await save(
      'vercel.json',
      JSON.stringify({
        ignoreCommand: 'bash scripts/vercel-ignore-build.sh -- apps/frontend vercel.json',
      }),
    );
    await save('apps/frontend/index.html', '<p>Public website</p>');
    const served = commit();
    await save('notes.md', 'Only notes change');
    const docs = commit();
    const relation = (expected, options = {}) =>
      readerReleaseRelation({ expected, served, cwd, ...options });
    assert.equal(relation(docs), 'mismatch', 'Exact mode must reject older equivalent stamps');
    assert.equal(relation(docs, { allowEquivalent: true }), 'older-equivalent-website');
    // Dirty working settings must not replace the intended commit's path list.
    await save('vercel.json', JSON.stringify({ ignoreCommand: 'malicious unsupported command' }));
    assert.equal(relation(docs, { allowEquivalent: true }), 'older-equivalent-website');
    git('restore', 'vercel.json');
    await save('apps/frontend/index.html', '<p>Changed website</p>');
    const changed = commit();
    assert.equal(relation(changed, { allowEquivalent: true }), 'mismatch');
    assert.equal(
      readerReleaseRelation({
        expected: changed,
        served,
        cwd: join(cwd, 'apps/frontend'),
        allowEquivalent: true,
      }),
      'mismatch',
      'Path equality must use repository root even when invoked inside frontend',
    );
    assert.equal(
      readerReleaseRelation({ expected: docs, served: changed, cwd, allowNewer: true }),
      'newer-descendant',
    );
    assert.equal(
      readerReleaseRelation({ expected: 'f'.repeat(40), served, cwd, allowEquivalent: true }),
      'unproven-history',
    );
    await save(
      'vercel.json',
      JSON.stringify({
        ignoreCommand: 'bash scripts/other-command.sh -- apps/frontend vercel.json',
      }),
    );
    const unsupported = commit();
    assert.equal(relation(unsupported, { allowEquivalent: true }), 'unproven-website-paths');
  } finally {
    await rm(cwd, { recursive: true });
  }
});

test('website path parsing refuses shell expressions, path magic, and missing release settings', async () => {
  const { websitePathsFromConfig } = await import('./reader-release-relation.mjs');
  const prefix = 'bash scripts/vercel-ignore-build.sh -- ';
  assert.deepEqual(
    websitePathsFromConfig(
      JSON.stringify({
        ignoreCommand:
          prefix +
          'api apps/frontend patches package.json pnpm-lock.yaml pnpm-workspace.yaml vercel.json',
      }),
    ),
    [
      'api',
      'apps/frontend',
      'patches',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'vercel.json',
    ],
  );
  for (const suffix of [
    'api',
    'api vercel.json; echo fake',
    'api $(fake) vercel.json',
    'api :!apps/frontend vercel.json',
    'api ../outside vercel.json',
    'api  vercel.json',
    'api "vercel.json"',
    'api vercel.json\n',
  ]) {
    assert.throws(() => websitePathsFromConfig(JSON.stringify({ ignoreCommand: prefix + suffix })));
  }
});

test('official source identity rejects wrong bills, wrong sessions and generic pages', async () => {
  const { officialBillIdentity, sameOfficialBill, selectedBillMatchesOfficialLink } =
    await import('./reader-official-bill.mjs');
  const expected = officialBillIdentity('https://www.revisor.mn.gov/bills/94/2025/0/HF/719/');
  assert.equal(selectedBillMatchesOfficialLink('/bills/94-2025-HF719', expected), true);
  assert.equal(selectedBillMatchesOfficialLink('/bills/94-2025-HF720', expected), false);
  assert.equal(
    sameOfficialBill(
      expected,
      officialBillIdentity(
        'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF0719&ssn=0&y=2025',
      ),
    ),
    true,
  );
  for (const url of [
    'https://www.revisor.mn.gov/bills/',
    'https://www.revisor.mn.gov/bills/94/2025/0/HF/720/',
    'https://www.revisor.mn.gov/bills/94/2026/0/HF/719/',
    'https://www.revisor.mn.gov/bills/94/2025/1/HF/719/',
    'https://www.revisor.mn.gov/bills/94/2025/0/SF/719/',
    'https://www.revisor.mn.gov/bills/95/2025/0/HF/719/',
    'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF720&ssn=0&y=2025',
    'https://www.revisor.mn.gov/bills/bill.php?b=Senate&f=HF719&ssn=0&y=2025',
    'https://www.revisor.mn.gov/bills/bill.php?f=HF719&f=HF720&ssn=0&y=2025',
    'https://www.revisor.mn.gov.evil.test/bills/94/2025/0/HF/719/',
  ])
    assert.equal(sameOfficialBill(expected, officialBillIdentity(url)), false);
});
