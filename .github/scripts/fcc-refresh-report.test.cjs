const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const report = require('./fcc-refresh-report.cjs');

async function run(result, existing = [], failed = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-report-'));
  const filename = path.join(folder, 'report.json');
  if (result) fs.writeFileSync(filename, JSON.stringify(result));
  const calls = [];
  const github = {
    paginate: async () => existing,
    rest: {issues: {
      listForRepo() {},
      update: async args => calls.push(['update', args]),
      create: async args => calls.push(['create', args]),
    }},
  };
  const core = {
    setFailed: message => calls.push(['failed', message]),
    summary: {addRaw: body => ({write: async () => calls.push(['summary', body])})},
  };
  try {
    await report({github, core, context: {
      repo: {owner: 'alethical-org', repo: 'alethical'},
      serverUrl: 'https://github.com', runId: 123,
    }, failed, path: filename});
    return calls;
  } finally { fs.rmSync(folder, {recursive: true}); }
}

const clean = {
  needs_attention: false, source_gaps: 0, reading_gaps: 0, reading_operational_failures: 0,
  collection: {listed_files: 4507, files_unchanged: 4498},
  backlog: {downloads: 0, second_copies: 0, readings: 0},
};
const existing = [{number: 7, title: 'FCC political-file archive: unresolved gaps or unfinished work'}];

test('source gaps update one issue with counts, never private source text', async () => {
  const calls = await run({...clean, source_gaps: 9, errors: {private: 'secret-value'}}, existing);
  assert.equal(calls.filter(([kind]) => kind === 'update').length, 1);
  const update = calls.find(([kind]) => kind === 'update')[1];
  assert.equal(update.issue_number, 7);
  assert.equal(update.state, 'open');
  assert.match(update.body, /did not make available: 9/);
  assert.doesNotMatch(JSON.stringify(calls), /secret-value/);
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 0);
});

test('missing report fails and creates a problem instead of claiming zero gaps', async () => {
  const calls = await run(null);
  assert.equal(calls[0][0], 'failed');
  const created = calls.find(([kind]) => kind === 'create')[1];
  assert.match(created.body, /Political files listed: unknown/);
  assert.match(created.body, /produce a report: yes/);
});

test('recovery closes the existing issue without a new comment', async () => {
  const calls = await run(clean, existing);
  assert.equal(calls.find(([kind]) => kind === 'update')[1].state, 'closed');
  assert.equal(calls.length, 2);
});

test('earlier workflow failure keeps an issue open even with a clean report', async () => {
  const calls = await run(clean, existing, true);
  assert.equal(calls.find(([kind]) => kind === 'update')[1].state, 'open');
});

test('a clean archive creates no alert issue', async () => {
  assert.deepEqual((await run(clean)).map(([kind]) => kind), ['summary']);
});

test('persisted unreadable documents keep the existing issue open', async () => {
  const calls = await run({...clean, reading_gaps: 3}, existing);
  const update = calls.find(([kind]) => kind === 'update')[1];
  assert.equal(update.state, 'open');
  assert.match(update.body, /Documents with incomplete readings: 3/);
});
