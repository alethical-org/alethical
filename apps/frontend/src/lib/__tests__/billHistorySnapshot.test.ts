import { describe, expect, it } from 'vitest';
import type { ApiBillDetailPayload } from '../../data/api';
import { billHistorySnapshot } from '../billHistorySnapshot';
import {
  billHistoryFromPayload,
  mapBillVotes,
  outcomeBillVotes,
  type ApiBillVotePayload,
} from '../billRecordReads';
import { buildActionTimeline } from '../billDetail';
import { billPageSnapshot, renderPageSnapshot } from '../pageSnapshot';

const bill: ApiBillDetailPayload = {
  id: '94-2025-HF719',
  title: 'Official title',
  chief_sponsors: [],
  actions: [
    {
      action_number: 1,
      action_text: 'Introduction and first reading, referred to',
      committee_name: 'Taxes',
      action_at: '2025-01-01',
    },
    {
      action_number: 2,
      action_text: 'See also',
      action_description: 'SF390',
      action_at: '2025-01-02',
      cross_references: [
        { id: '94-2025-SF390', code: 'SF 390', title: 'Companion', status_key: 'introduced' },
      ],
    },
  ],
};
const passage: ApiBillVotePayload = {
  id: 'passage',
  motion_text: 'Third reading',
  result_text: 'Bill was passed',
  chamber: 'house',
  occurred_at: '2025-05-01',
  yes_count: 2,
  no_count: 1,
  official_url: 'https://www.house.mn.gov/votes/test',
  records: [
    {
      legislator_id: 'a',
      slug: 'anna-member',
      legislator_name: 'Anna Member',
      party: 'DFL',
      vote_value: 'yes',
    },
    { legislator_id: 'b', legislator_name: '<Ben & Member>', party: 'R', vote_value: 'no' },
    { legislator_id: 'c', legislator_name: 'Charlie Member', party: 'DFL', vote_value: 'yes' },
  ],
};
const procedure: ApiBillVotePayload = {
  ...passage,
  id: 'procedure',
  motion_text: 'Suspension of rules',
  result_text: 'Motion prevailed',
};

describe('bill first-response history', () => {
  it('uses exactly the loaded page action normalization and outcome vote order', () => {
    const records = [passage, procedure, { ...passage, id: 'newer', occurred_at: '2025-05-02' }];
    const history = billHistoryFromPayload(bill);
    const votes = mapBillVotes(records);
    const sections = billHistorySnapshot(bill, records);
    const timeline = buildActionTimeline(
      history.actions,
      votes,
      new Date(),
      history.effectiveSchedule,
      history.sponsors,
    );
    const printed = JSON.stringify(sections);
    for (const row of timeline.rows) expect(printed).toContain(row.title);
    const rolls = outcomeBillVotes(votes);
    expect(rolls.map(({ vote }) => vote.id)).toEqual(['newer', 'passage']);
    expect(
      sections
        .filter((section) => section.heading.startsWith('House'))
        .map((section) => section.heading),
    ).toEqual(['House · Final passage · MAY 2, 2025', 'House · Final passage · MAY 1, 2025']);
    expect(printed).not.toContain('Suspension of rules');
    expect(printed).toContain('/bills/94-2025-SF390');
  });
  it('lists recorded members only, with official links and escaped source text', () => {
    const snapshot = billPageSnapshot(bill);
    snapshot.sections = billHistorySnapshot(bill, [passage]);
    const html = renderPageSnapshot(snapshot);
    expect(html).toContain('<th');
    expect(html).toContain(
      'Only recorded members are listed. Absent and excused members are not inferred.',
    );
    expect(html).toContain('https://www.house.mn.gov/votes/test');
    expect(html).toContain('/legislators/anna-member');
    expect(html).toContain('&lt;Ben &amp; Member&gt;');
    expect(html).not.toContain('didn’t vote');
    expect(html).not.toContain('134');
  });
  it('distinguishes no votes, procedural votes only, and a failed vote request', () => {
    expect(JSON.stringify(billHistorySnapshot(bill, []))).toContain('No recorded roll-call votes');
    expect(JSON.stringify(billHistorySnapshot(bill, [procedure]))).toContain(
      'No recorded roll-call votes',
    );
    const failed = JSON.stringify(billHistorySnapshot(bill, null));
    expect(failed).toContain('We couldn’t load this bill’s votes');
    expect(failed).not.toContain('No recorded');
    expect(failed).not.toContain('Taxes');
  });
});
