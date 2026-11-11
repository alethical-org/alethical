import { describe, expect, it, vi } from 'vitest';

import { apiGet } from '../api/read';
import {
  accountEvidencePath,
  candidateOutsideRecordsPath,
  electionFinancePath,
  electionOutsideRecordsPath,
  electionOutsideSpendingPath,
  electionPrecinctsPath,
  electionRacePath,
  electionRacesPath,
  electionSourceLinesPath,
  electionSourcePath,
  electionsPath,
  financeReportSourcePath,
  financeSourceLinesPath,
  financeSourcePath,
  reportedAmount,
  type AccountEvidence,
  type ResultCandidate,
  type SpendingMeasure,
} from '../pages/elections/data';

const election = 'mn-2026-11-03-general';
const historicalElection = 'mn-2024-11-05-general';
const snapshot = 'a'.repeat(64);
const race = 'b'.repeat(64);
const source = 'c'.repeat(64);
const collection = 'd'.repeat(64);
const version = '0123456789abcdef';
const release = '00000000-0000-0000-0000-000000000123';
const parsed = (path: string) => new URL(path, 'https://api.test/api/v1/');

function measure(state: SpendingMeasure['state'], amount: string | null): SpendingMeasure {
  return {
    state,
    amount,
    record_count: state === 'no_records' ? 0 : 2,
    known_amount_subtotal: state === 'no_records' ? null : '123.0000',
    missing_amount_count: state === 'amount_unavailable' ? 1 : 0,
    included_unpaid_amount: null,
    known_unpaid_subtotal: null,
    missing_unpaid_count: 1,
    missing_date_count: 1,
    missing_year_count: 0,
    date_year_conflict_count: 0,
    date_coverage: 'incomplete',
    first_known_date: '2026-10-01',
    last_known_date: '2026-10-01',
  };
}

describe('published election paths', () => {
  it('keeps one immutable result snapshot across race and precinct pages', () => {
    expect(electionsPath()).toBe('finance/elections');
    const list = parsed(
      electionRacesPath(election, {
        snapshotId: snapshot,
        query: 'St. Paul % & /',
        limit: 25,
        offset: 25,
      }),
    );
    expect(list.pathname).toBe(`/api/v1/finance/elections/${election}/races`);
    expect(list.searchParams.get('q')).toBe('St. Paul % & /');
    expect(list.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(list.searchParams.get('offset')).toBe('25');
    expect(list.searchParams.has('version')).toBe(false);
    const detail = parsed(electionRacePath(election, race, snapshot));
    const precinct = parsed(
      electionPrecinctsPath(election, race, {
        snapshotId: snapshot,
        county: '01',
        query: '100%',
        offset: 50,
        limit: 50,
      }),
    );
    expect(detail.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(precinct.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(precinct.searchParams.get('county')).toBe('01');
    expect(precinct.searchParams.get('q')).toBe('100%');
    expect(precinct.pathname).toBe(`${detail.pathname}/precincts`);
    expect(parsed(electionRacePath(election, race)).searchParams.has('snapshot_id')).toBe(false);
  });

  it('pins report comparisons and candidate payment records with the same version', () => {
    const summary = parsed(electionFinancePath(election, race, { snapshotId: snapshot, version }));
    const rows = parsed(
      candidateOutsideRecordsPath(election, race, 'candidate/one & two', {
        snapshotId: snapshot,
        version,
        offset: 0,
        limit: 100,
      }),
    );
    expect(summary.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(summary.searchParams.get('version')).toBe(version);
    expect(rows.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(rows.searchParams.get('version')).toBe(version);
    expect(rows.searchParams.get('offset')).toBe('0');
    expect(rows.pathname).toContain('candidate%2Fone%20%26%20two');
    expect(rows.pathname.endsWith('/outside-spending')).toBe(true);
  });

  it('pins statewide payments without changing exact empty or negative registrations', () => {
    const summary = parsed(
      electionOutsideSpendingPath(election, {
        snapshotId: snapshot,
        spenderType: 'PTU',
        direction: 'Against',
        targetRegistration: '',
      }),
    );
    expect(summary.searchParams.get('election_snapshot_id')).toBe(snapshot);
    expect(summary.searchParams.get('spender_type')).toBe('PTU');
    expect(summary.searchParams.get('direction')).toBe('Against');
    expect(summary.searchParams.has('target_registration')).toBe(true);
    expect(summary.searchParams.get('target_registration')).toBe('');
    const rows = parsed(
      electionOutsideRecordsPath(election, {
        version,
        releaseId: release,
        snapshotId: snapshot,
        scope: 'missing_year',
        targetRegistration: '-101',
        spenderRegistration: '',
        limit: 2,
        offset: 2,
      }),
    );
    expect(rows.searchParams.get('release_id')).toBe(release);
    expect(rows.searchParams.get('version')).toBe(version);
    expect(rows.searchParams.get('scope')).toBe('missing_year');
    expect(rows.searchParams.get('target_registration')).toBe('-101');
    expect(rows.searchParams.has('spender_registration')).toBe(true);
    expect(rows.searchParams.get('spender_registration')).toBe('');
    expect(
      parsed(electionOutsideSpendingPath(election, { targetRegistration: null })).searchParams.has(
        'target_registration',
      ),
    ).toBe(false);
    expect(
      parsed(electionOutsideSpendingPath(election)).searchParams.has('target_registration'),
    ).toBe(false);
  });

  it('keeps literal filed strings as one query value', () => {
    const value = "x' OR 1=1 --&version=other";
    const rows = parsed(
      electionOutsideRecordsPath(election, {
        version,
        releaseId: release,
        targetRegistration: value,
      }),
    );
    expect(rows.searchParams.get('target_registration')).toBe(value);
    expect(rows.searchParams.getAll('version')).toEqual([version]);
  });
});

describe('retained source paths', () => {
  it('keeps result snapshots and financial collection IDs in their own source routes', () => {
    const result = parsed(electionSourcePath(election, source, snapshot));
    const lines = parsed(
      electionSourceLinesPath(election, source, snapshot, {
        start: 431,
        limit: 20,
      }),
    );
    expect(result.searchParams.get('snapshot_id')).toBe(snapshot);
    expect(result.searchParams.has('collection_id')).toBe(false);
    expect(lines.pathname).toBe(`${result.pathname}/lines`);
    expect(lines.searchParams.get('start')).toBe('431');
    const pdf = parsed(financeReportSourcePath(election, source, collection));
    const raw = parsed(financeSourcePath(election, source, collection));
    const financialLines = parsed(
      financeSourceLinesPath(election, source, collection, {
        start: 2,
        limit: 1,
      }),
    );
    expect(pdf.searchParams.get('collection_id')).toBe(collection);
    expect(raw.pathname).toBe(`${pdf.pathname}/raw`);
    expect(financialLines.pathname).toBe(`${pdf.pathname}/lines`);
    expect(financialLines.searchParams.get('collection_id')).toBe(collection);
    expect(financialLines.searchParams.get('limit')).toBe('1');
  });

  it.each(['committee_register', 'candidate_identity'])(
    'derives a %s source address from its published historical collection',
    (kind) => {
      const evidence: AccountEvidence = {
        kind,
        sha256: source,
        collection_id: collection,
        source_election_key: historicalElection,
        source_state: 'available',
        retained_source_url: 'https://unrelated.invalid/secret',
      };
      expect(accountEvidencePath(evidence)).toBe(
        financeSourcePath(historicalElection, source, collection),
      );
      expect(accountEvidencePath(evidence, 'lines', { start: 3, limit: 1 })).toBe(
        financeSourceLinesPath(historicalElection, source, collection, {
          start: 3,
          limit: 1,
        }),
      );
      expect(accountEvidencePath({ ...evidence, source_state: 'unavailable' })).toBeNull();
      expect(accountEvidencePath({ ...evidence, source_state: undefined })).toBeNull();
      expect(accountEvidencePath({ ...evidence, collection_id: undefined })).toBeNull();
      expect(accountEvidencePath({ ...evidence, sha256: '../other' })).toBeNull();
      expect(
        accountEvidencePath({
          ...evidence,
          source_election_key: 'https://unrelated.invalid',
        }),
      ).toBeNull();
    },
  );
});

describe('source numbers and existing request handling', () => {
  it('keeps exact decimals and never fills a missing total with zero or a subtotal', () => {
    expect(reportedAmount(measure('reported', '0.0000'))).toBe('0.0000');
    expect(reportedAmount(measure('reported', '-12345678901234.5678'))).toBe(
      '-12345678901234.5678',
    );
    expect(reportedAmount(measure('amount_unavailable', null))).toBeNull();
    expect(reportedAmount(measure('no_records', null))).toBeNull();
    expect(reportedAmount(null)).toBeNull();
    expect(reportedAmount(undefined)).toBeNull();
  });

  it('uses Finance auth through apiGet while preserving null votes and source decimals', async () => {
    const candidates: ResultCandidate[] = [
      {
        candidate_id: null,
        name: 'Unmatched choice',
        votes: null,
        is_write_in_aggregate: false,
        outcome: null,
      },
      {
        candidate_id: null,
        name: 'WRITE-IN',
        votes: 0,
        is_write_in_aggregate: true,
        outcome: null,
      },
    ];
    const payload = {
      candidates,
      total: measure('reported', '9007199254740991.0001'),
    };
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: payload }), { status: 200 }),
    );
    const result = await apiGet<typeof payload>(
      'https://api.test',
      electionFinancePath(election, race, { snapshotId: snapshot }),
      'test-token',
      fetcher,
    );
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer test-token',
    });
    expect(result.state).toBe('ok');
    if (result.state === 'ok') {
      expect(result.data.candidates.map((candidate) => candidate.votes)).toEqual([null, 0]);
      expect(reportedAmount(result.data.total)).toBe('9007199254740991.0001');
    }
  });

  it('leaves changed-version handling with the shared reader', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'https://api.alethical.com/problems/records-changed',
            status: 409,
          }),
          { status: 409 },
        ),
    );
    const answer = await apiGet(
      'https://api.test',
      electionOutsideRecordsPath(election, { version, releaseId: release }),
      'test-token',
      fetcher,
    );
    expect(answer).toMatchObject({ state: 'failed', changed: true });
  });
});
