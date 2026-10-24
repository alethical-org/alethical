import type { ApiBillDetailPayload } from '../data/api';
import type { SnapshotSection } from './pageSnapshot';
import {
  billHistoryFromPayload,
  BILL_VOTE_COVERAGE,
  BILL_VOTES_UNAVAILABLE,
  mapBillVotes,
  outcomeBillVotes,
  type ApiBillVotePayload,
} from './billRecordReads';
import {
  buildActionTimeline,
  buildPartyBlocks,
  crossReferenceTargets,
  formatMonoDate,
} from './billDetail';
import { normalizeMemberName } from './motionNormalize';

/** The existing record cards and tables, fed by the loaded page's own shapers. */
export function billHistorySnapshot(
  source: ApiBillDetailPayload,
  records: ApiBillVotePayload[] | null,
  now = new Date(),
): SnapshotSection[] {
  // The loaded Actions tab also requires votes to classify its passage rows.
  if (records === null) {
    return [{ heading: 'Actions and votes', body: [BILL_VOTES_UNAVAILABLE] }];
  }
  const bill = billHistoryFromPayload(source);
  const votes = mapBillVotes(records);
  const timeline = buildActionTimeline(
    bill.actions,
    votes,
    now,
    bill.effectiveSchedule,
    bill.sponsors,
  );
  const path = `/bills/${encodeURIComponent(source.id)}`;
  const sections: SnapshotSection[] = [
    {
      id: 'actions',
      heading: 'Actions',
      blocks: timeline.rows.flatMap((row) => [
        {
          kind: 'prose' as const,
          lines: [
            [row.dateRange || row.date, row.title, row.tally].filter(Boolean).join(' · '),
            ...(row.meta ? [row.meta] : []),
            ...(row.note ? [row.note] : []),
          ],
        },
        {
          kind: 'links' as const,
          items: [
            ...(row.showVotes ? [{ label: 'View votes', href: `${path}?tab=votes` }] : []),
            ...crossReferenceTargets(row).map((target) => ({
              label: `${target.code} — ${target.title}${target.status ? ` · ${target.status}` : ''}`,
              href: `/bills/${encodeURIComponent(target.billId)}`,
            })),
          ],
        },
      ]),
    },
  ];
  if (timeline.glossary.length) {
    sections.push({
      heading: 'Plain-language key',
      items: timeline.glossary.map(({ term, def }) => ({ label: `${term} — ${def}` })),
    });
  }
  const rolls = outcomeBillVotes(votes);
  sections.push({
    id: 'votes',
    heading: 'Votes',
    body: [
      rolls.length
        ? 'Each recorded roll call lists how members voted.'
        : 'No recorded roll-call votes',
    ],
  });
  for (const { vote, norm } of rolls) {
    const blocks = buildPartyBlocks(
      vote.votes.map((member) => ({
        ...member,
        name: normalizeMemberName(member.name, vote.chamber),
      })),
    );
    sections.push({
      heading: [vote.chamber, norm.title, formatMonoDate(vote.date)].filter(Boolean).join(' · '),
      blocks: [
        {
          kind: 'prose',
          lines: [
            norm.subline,
            `${norm.passed ? 'PASSED' : 'FAILED'} · ${vote.breakdown.yes}–${vote.breakdown.no}`,
            ...(vote.breakdown.absent ? [`${vote.breakdown.absent} didn’t vote`] : []),
            BILL_VOTE_COVERAGE,
          ].filter(Boolean),
        },
        ...(vote.votes.length
          ? [
              {
                kind: 'table' as const,
                columns: ['Member', 'Party', 'Vote'],
                rowHeaders: true,
                rows: blocks.flatMap((block) =>
                  block.members.map((member) => [
                    {
                      text: member.name,
                      href: `/legislators/${encodeURIComponent(member.slug ?? member.legislatorId)}`,
                    },
                    block.label,
                    member.vote === 'ABSENT' ? 'Didn’t vote' : member.vote === 'YES' ? 'Yes' : 'No',
                  ]),
                ),
              },
            ]
          : []),
        {
          kind: 'links',
          items: [
            ...(vote.officialUrl ? [{ label: 'Official record', href: vote.officialUrl }] : []),
          ],
        },
      ],
    });
  }
  return sections;
}
