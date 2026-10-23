import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VotesTab } from '../../components/billDetail/VotesTab';
import { mapBillDetail, type ApiBillDetailPayload } from '../../data/api';
import { buildPartyBlocks } from '../billDetail';
import { billHistorySnapshot } from '../billHistorySnapshot';
import { mapBillVotes, type ApiBillVotePayload } from '../billRecordReads';
import { billPageSnapshot, renderPageSnapshot } from '../pageSnapshot';

vi.mock('react-native-svg', () => {
  const stub = () => null;
  return { default: stub, Svg: stub, Circle: stub, Path: stub };
});

const source: ApiBillDetailPayload = {
  id: '94-2025-HF719',
  title: 'Official title',
  chief_sponsors: [],
  actions: [],
};

function roll(parties: Array<string | null | undefined>): ApiBillVotePayload {
  return {
    id: 'passage',
    motion_text: 'Third reading',
    result_text: 'Bill was passed',
    chamber: 'house',
    occurred_at: '2025-05-01',
    yes_count: parties.length - 1,
    no_count: 1,
    records: parties.map((party, index) => ({
      legislator_id: `member-${index}`,
      legislator_name: `Member ${index}`,
      party,
      vote_value: index === parties.length - 1 ? 'no' : 'yes',
    })),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('recorded member parties', () => {
  it('keeps missing and unrecognized parties separate from explicit Independents', () => {
    const records = roll([
      null,
      undefined,
      '',
      'unrecognized',
      'Not a Democrat',
      'I',
      'Independent',
    ]);
    const blocks = buildPartyBlocks(mapBillVotes([records])[0].votes);
    expect(blocks.map((block) => block.party)).toEqual(['DFL', 'R', 'I', 'unknown']);
    expect(
      blocks.find((block) => block.party === 'I')?.members.map((member) => member.legislatorId),
    ).toEqual(['member-5', 'member-6']);
    const unknown = blocks.find((block) => block.party === 'unknown');
    expect(unknown?.label).toBe('Party not recorded');
    expect(unknown?.members.map((member) => member.legislatorId)).toEqual([
      'member-0',
      'member-1',
      'member-2',
      'member-3',
      'member-4',
    ]);
  });

  it('never marks an unknown party minority as crossover, but keeps known party crossovers', () => {
    const unknown = buildPartyBlocks(mapBillVotes([roll([null, '', 'unrecognized'])])[0].votes);
    expect(
      unknown
        .find((block) => block.party === 'unknown')
        ?.members.every((member) => !member.crossover),
    ).toBe(true);
    for (const party of ['DFL', 'R', 'I']) {
      const blocks = buildPartyBlocks(mapBillVotes([roll([party, party, party])])[0].votes);
      expect(
        blocks
          .find((block) => block.party === party)
          ?.members.filter((member) => member.crossover)
          .map((member) => member.legislatorId),
      ).toEqual(['member-2']);
    }
  });

  it('retains supported party names and omits an empty unknown group', () => {
    const records = roll([
      'DFL',
      'D',
      'Democrat',
      'Democratic',
      'Democratic-Farmer-Labor',
      'R',
      'Republican',
      ' independent ',
    ]);
    const blocks = buildPartyBlocks(mapBillVotes([records])[0].votes);
    expect(blocks.map((block) => [block.party, block.seats])).toEqual([
      ['DFL', 5],
      ['R', 2],
      ['I', 1],
    ]);
  });

  it('renders the same unknown and Independent members in the first response and loaded vote cards', () => {
    vi.stubGlobal('__DEV__', false);
    const records = [roll([null, 'unrecognized', 'Independent'])];
    const snapshot = billPageSnapshot(source);
    snapshot.sections = billHistorySnapshot(source, records);
    const firstResponse = renderPageSnapshot(snapshot);
    const loaded = renderToStaticMarkup(
      createElement(VotesTab, {
        bill: mapBillDetail(source, records),
        chiefParty: undefined,
        onOpenLegislator: () => {},
        onOpenUrl: () => {},
        onAsk: () => {},
        updatedLabel: '',
      }),
    );
    for (const html of [firstResponse, loaded]) {
      expect(html).toContain('Party not recorded');
      expect(html).toContain('Independent');
      expect(html).toContain('Member 0');
      expect(html).toContain('Member 1');
      expect(html).toContain('Member 2');
    }
    const voteTable = snapshot.sections
      .flatMap((section) => section.blocks ?? [])
      .find((block) => block.kind === 'table');
    expect(voteTable?.kind === 'table' && voteTable.rows.map((row) => [row[0], row[1]])).toEqual([
      [{ text: 'Rep. Member 2', href: '/legislators/member-2' }, 'Independent'],
      [{ text: 'Rep. Member 0', href: '/legislators/member-0' }, 'Party not recorded'],
      [{ text: 'Rep. Member 1', href: '/legislators/member-1' }, 'Party not recorded'],
    ]);
    const independentCard = loaded.slice(
      loaded.indexOf('Independent'),
      loaded.indexOf('Party not recorded'),
    );
    expect(independentCard).toContain('Rep. Member 2');
    expect(independentCard).not.toContain('Rep. Member 0');
    expect(independentCard).not.toContain('Rep. Member 1');
    const unknownCard = loaded.slice(loaded.indexOf('Party not recorded'));
    expect(unknownCard).toContain('Rep. Member 0');
    expect(unknownCard).toContain('Rep. Member 1');
    expect(unknownCard).not.toContain('Rep. Member 2');
  });
});
