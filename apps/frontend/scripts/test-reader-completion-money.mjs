import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readerFixtures } from './reader-completion-fixtures.mjs';
import { MONEY_EXPECTATIONS, readerMoneyFixtures } from './reader-completion-money.mjs';
import { runReaderChecks } from './reader-completion-checks.mjs';

const params = (query) => new URLSearchParams(query);

test('money snapshots belong to the profile that the directory opens', async () => {
  const fixture = await readerFixtures();
  const { data: profiles } = fixture('/api/v1/legislators');
  assert.equal(profiles.length, 1);
  const profile = profiles[0];
  assert.equal(profile.full_name, 'Jim Abeler');
  assert.equal(profile.slug, 'jim-abeler');
  assert.equal(profile.campaign_committees[0].registration_number, '17868');
  for (const id of [profile.id, profile.slug]) {
    const { data } = fixture(`/api/v1/legislators/${id}/campaign-finance`, params('year=2025'));
    assert.equal(data.legislator_id, profile.id);
    assert.equal(data.year, 2025);
    assert.equal(data.committees.length, 1);
    assert.equal(data.committees[0].registration_number, '17868');
    assert.equal(data.committees[0].split.reported_total, '97703.7500');
    assert.equal(data.committees[0].money_out.reported_total, '33006.2900');
    assert.equal(data.filings_copied_at, null);
    const payment = fixture(
      '/api/v1/committees/17868/payments',
      params('year=2025&direction=received&offset=0'),
    );
    assert.equal(data.release_id, payment.data.release_id);
    assert.equal(data.fetched_at, payment.data.fetched_at);
    assert.equal(payment.data.payments.length, payment.data.page.total_payments);
    assert.equal(payment.data.page.has_more, false);
  }
});

test('money fixtures require the matching year, committee and payment direction', async () => {
  const money = await readerMoneyFixtures();
  const path = `/api/v1/legislators/${money.profile.id}/campaign-finance`;
  for (const query of ['', 'year=2026', 'year=2025&year=2024', 'year=20250', 'year=2025evil'])
    assert.equal(money.response(path, params(query)), undefined);
  assert.equal(
    money.response('/api/v1/legislators/someone-else/campaign-finance', params('year=2025')),
    undefined,
  );
  for (const query of [
    'year=2024&direction=received',
    'year=2025&direction=made',
    'year=2025&direction=received&offset=250',
  ])
    assert.equal(money.response('/api/v1/committees/17868/payments', params(query)), undefined);
  assert.equal(
    money.response('/api/v1/committees/99999/payments', params('year=2025&direction=received')),
    undefined,
  );
});

test('synthetic missing totals remain null while filed zero remains an explicit amount', async () => {
  const money = await readerMoneyFixtures();
  const path = `/api/v1/legislators/${money.profile.id}/campaign-finance`;
  const { data } = money.response(path, params('year=2024'));
  const [missing, zero] = data.committees;
  assert.equal(missing.committee_name, 'Synthetic missing-total committee');
  assert.equal(missing.registration_number, MONEY_EXPECTATIONS.missing.registration);
  assert.equal(missing.split.reported_total, null);
  assert.equal(missing.split.named_total, '123.0000');
  assert.equal(missing.money_out.reported_total, null);
  assert.equal(missing.money_out.itemized_payment_total, '456.0000');
  assert.equal(zero.committee_name, 'Synthetic zero-total committee');
  assert.equal(zero.registration_number, MONEY_EXPECTATIONS.zero.registration);
  assert.equal(zero.split.reported_total, '0.0000');
  assert.equal(zero.money_out.reported_total, '0.0000');
  missing.split.reported_total = '0.0000';
  assert.equal(
    money.response(path, params('year=2024')).data.committees[0].split.reported_total,
    null,
  );
});

test('deliberate money failure removes only the money response and cannot run against live mode', async () => {
  const fixture = await readerFixtures({ failMoney: 'unavailable' });
  const profile = fixture('/api/v1/legislators').data[0];
  assert.ok(fixture(`/api/v1/legislators/${profile.id}`).data);
  assert.equal(
    fixture(`/api/v1/legislators/${profile.id}/campaign-finance`, params('year=2025')),
    undefined,
  );
  const directory = await mkdtemp(join(tmpdir(), 'reader-money-guard-'));
  try {
    const output = join(directory, 'result.json');
    for (const options of [
      { fixtureMoneyFailure: 'unavailable' },
      { fixtures: true, fixtureMoneyFailure: 'unavailable' },
    ]) {
      const report = await runReaderChecks({
        baseUrl: 'https://www.alethical.com',
        output,
        ...options,
      });
      assert.equal(report.passed, false);
      assert.equal(report.checks[0].name, 'input-safety');
      assert.equal(
        report.checks[0].failure,
        options.fixtures
          ? 'production-fixture-target-rejected'
          : 'money-failure-injection-requires-fixtures',
      );
      assert.equal(JSON.parse(await readFile(output, 'utf8')).passed, false);
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

// These deliberately bad responses exercise the real application's display in
// browser CI. Its expected text remains unchanged when the input is corrupted.
test('wrong amount and missing-as-zero mutations cannot rewrite their expected answers', async () => {
  const wrong = await readerMoneyFixtures({ failMoney: 'wrong-amount' });
  const path = `/api/v1/legislators/${wrong.profile.id}/campaign-finance`;
  assert.equal(
    wrong.response(path, params('year=2025')).data.committees[0].split.reported_total,
    '96703.7500',
  );
  assert.equal(MONEY_EXPECTATIONS.real.contributions, '$97,703');
  const zero = await readerMoneyFixtures({ failMoney: 'missing-as-zero' });
  assert.equal(
    zero.response(path, params('year=2024')).data.committees[0].money_out.reported_total,
    '0.0000',
  );
  await assert.rejects(
    readerMoneyFixtures({ failMoney: 'unknown' }),
    /Invalid money failure fixture/,
  );
});
