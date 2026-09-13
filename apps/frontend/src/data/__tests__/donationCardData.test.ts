import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getCommitteeFinanceFromApi, getLegislatorCampaignMoneyFromApi } from '../api';
import { publicReadResponse } from '../../lib/publicRead';

vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test'));
afterAll(() => vi.unstubAllEnvs());
vi.mock('../../lib/publicRead', () => ({ publicReadResponse: vi.fn() }));
const read = vi.mocked(publicReadResponse);
afterEach(() => vi.clearAllMocks());

const reported = {
  stated_by_kind: {
    state: 'reported',
    reported_through: '2025-12-31',
    lines: [
      {
        line_key: 'individuals_contributions',
        label_as_filed: 'Individuals contributions',
        stated_total: '66203.7500',
        itemized_cash_total: '39950.0000',
        difference: '26253.7500',
      },
    ],
  },
  donor_states: {
    state: 'reported',
    year: 2025,
    rows: [{ names: 71, cash_total: '38700.0000', state: 'MN' }],
    summary: {
      minnesota: { names: 71, cash_total: '38700.0000' },
      other_states: { names: 0, cash_total: '0' },
      unknown: { names: 3, cash_total: '1250.0000' },
    },
    reference: {
      source_url: 'https://www.huduser.gov/portal/datasets/usps_crosswalk.html',
      as_of: '2026-06-30',
      copied_at: '2026-09-13T12:19:46.695703+00:00',
      content_hash: '1175d0496ea66ec6a571ce47adb63502ef8485b20e8f1ded635ea0ff351f5627',
    },
  },
  name_connections: {
    state: 'reported',
    year: 2025,
    matching: 'exact_printed_name',
    numerator: 19,
    denominator: 74,
    distribution: [{ other_committees: '4+', names: 2 }],
    top_names: [{ name: 'Kratsch, Charles', other_committees: 11 }],
  },
};

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { Age: '30' } });
}

async function readBoth(blocks: Record<string, unknown>) {
  read
    .mockResolvedValueOnce(
      response({
        registration_number: '17868',
        committee_name: 'Test committee',
        year: 2025,
        ...blocks,
      }),
    )
    .mockResolvedValueOnce(
      response({
        legislator_id: 'test-member',
        year: 2025,
        link_state: 'confirmed',
        release_id: 'test-release',
        committees: [
          {
            registration_number: '17868',
            committee_name_as_reviewed: 'Test committee',
            split: { state: 'no_reported_total' },
            ...blocks,
          },
        ],
      }),
    );
  const committee = await getCommitteeFinanceFromApi('17868', 2025);
  const legislator = await getLegislatorCampaignMoneyFromApi('test-member', 2025);
  return [committee!, legislator.committees[0]];
}

describe('donation card blocks on both campaign-money responses', () => {
  it('keeps the server field names and exact money strings', async () => {
    for (const money of await readBoth(reported)) {
      expect(money.statedByKind).toEqual(reported.stated_by_kind);
      expect(money.donorStates).toEqual(reported.donor_states);
      expect(money.nameConnections).toEqual(reported.name_connections);
      expect(money.statedByKind?.lines[0].stated_total).toBe('66203.7500');
      expect(money.donorStates?.summary.unknown.cash_total).toBe('1250.0000');
      expect(money.donorStates?.rows[0]).not.toHaveProperty('zip');
    }
  });

  it('keeps empty and withheld answers distinct from zero', async () => {
    const held = {
      stated_by_kind: {
        state: 'sources_disagree',
        reported_through: '2025-12-31',
        lines: [],
      },
      donor_states: null,
      name_connections: {
        state: 'not_reported',
        year: 2025,
        matching: 'exact_printed_name',
        numerator: null,
        denominator: null,
        distribution: [],
        top_names: [],
      },
    };
    for (const money of await readBoth(held)) {
      expect(money.statedByKind).toEqual(held.stated_by_kind);
      expect(money.donorStates).toBeNull();
      expect(money.nameConnections).toEqual(held.name_connections);
      expect(money.nameConnections?.numerator).toBeNull();
    }
  });

  it('does not add the blocks to older cached responses that omitted them', async () => {
    for (const money of await readBoth({})) {
      expect(money).not.toHaveProperty('statedByKind');
      expect(money).not.toHaveProperty('donorStates');
      expect(money).not.toHaveProperty('nameConnections');
    }
  });
});
