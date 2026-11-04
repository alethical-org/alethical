import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A summary citation's section position belongs to the version the summary was
 * written from (#2856). The Bill Text tab renders the current version, so a
 * position may badge or open a section only when those are the same version
 * (#2857). Each case renders the real Summary tab, the real Bill Text tab and the
 * served page snapshot from 1 payload: the current version repeats the cited
 * section id at the cited position, so a position taken from an older version
 * would land on a real, wrong section here.
 */

vi.mock('react-native-svg', () => {
  const stub = () => null;
  return { default: stub, Svg: stub, Circle: stub, Path: stub, G: stub, Rect: stub, Line: stub };
});
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => true }));
vi.mock('../../providers/trackedBillWriteContext', () => ({
  useTrackedBillWrite: () => ({ failures: {}, retryTrackedBill: () => {} }),
}));
vi.mock('../../hooks/useAppQueries', () => ({
  usePrefetchSuggestedAnswer: () => () => {},
  useTrackedListState: () => ({ state: () => 'ready', recheck: () => {} }),
  // The current version's text: the cited id repeats, and position 3 is a real
  // section a stray position would badge.
  useBillVersionText: (_billId: string, versionCode: string) => ({
    isSuccess: true,
    isLoading: false,
    isError: false,
    data:
      versionCode === '2'
        ? [1, 2, 3].map((order) => ({
            sectionId: 'laws.0.1.0',
            sourceOrder: order,
            heading: `Sec. ${order}. CURRENT RULE ${order}.`,
            articleHeading: null,
            text: `Current text ${order}.`,
            bodyBlocks: null,
          }))
        : [],
  }),
}));

const { SummaryTab } = await import('../../components/billDetail/SummaryTab');
const { FullTextTab } = await import('../../components/billDetail/FullTextTab');
const { mapBillDetail } = await import('../../data/api');
const { billPageSnapshot, renderPageSnapshot } = await import('../pageSnapshot');
const { citationsForRenderedText } = await import('../billText');

function payload(summaryVersion: string | null) {
  return {
    id: '94-2025-HF719',
    title: 'A bill for an act relating to capital investment',
    chief_sponsors: [],
    versions: [
      { version_code: '1', version_name: '2025.0-HF0719-1', is_current: false },
      { version_code: '2', version_name: '2025.0-HF0719-2', is_current: true },
    ],
    summary_source_version: summaryVersion ? { version_code: summaryVersion } : null,
    ai_analysis: {
      short_title: 'Capital Projects Bill',
      summary: 'Repeals the old rule.',
      citations: [
        {
          id: 'laws.0.1.0-0',
          label: 'Sec. 3',
          url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/1/',
          excerpt: 'The old rule is repealed.',
          section_id: 'laws.0.1.0',
          section_order: 3,
          section_topic: 'Old rule',
        },
      ],
    },
  };
}

function render(summaryVersion: string | null) {
  const bill = mapBillDetail(payload(summaryVersion) as never, []);
  const summary = renderToStaticMarkup(
    <SummaryTab
      bill={bill}
      showAsk={false}
      onAsk={() => {}}
      onOpenUrl={() => {}}
      onOpenLegislator={() => {}}
      onOpenBill={() => {}}
      isDesktop
      updatedLabel="Updated"
      onCitationPress={() => {}}
      onJumpToActions={() => {}}
    />,
  );
  const text = renderToStaticMarkup(<FullTextTab bill={bill} updatedLabel="Updated" />);
  const served = renderPageSnapshot(billPageSnapshot(payload(summaryVersion) as never));
  return { bill, summary, text, served };
}

const JUMP = '?tab=text#ft-laws.0.1.0-3';

describe('summary citations on the Bill Text tab (#2857)', () => {
  it('badges and links the cited section when the summary was written from the version shown', () => {
    const { bill, summary, text, served } = render('2');
    expect(bill.citations[0].sectionOrder).toBe(3);
    expect(text.match(/CITED IN SUMMARY/g)).toHaveLength(1);
    expect(summary).toContain(JUMP);
    expect(served).toContain(JUMP);
  });

  it('never badges or links a section when the summary was written from an older version', () => {
    const { bill, summary, text, served } = render('1');
    expect(bill.citations[0].sectionOrder).toBeNull();
    expect(text).not.toContain('CITED IN SUMMARY');
    expect(summary).not.toContain('#ft-');
    expect(served).not.toContain('#ft-');
    // The chip keeps its label and quote.
    expect(summary).toContain('The old rule is repealed.');
    expect(served).toContain('Sec. 3');
  });

  it('never badges or links a section when the summary is linked to no version', () => {
    const { bill, summary, text, served } = render(null);
    expect(bill.citations[0].sectionOrder).toBeNull();
    expect(text).not.toContain('CITED IN SUMMARY');
    expect(summary).not.toContain('#ft-');
    expect(served).not.toContain('#ft-');
  });

  it('keeps positions only for an exact version match', () => {
    const cited = [{ sectionOrder: 4 }];
    expect(citationsForRenderedText(cited, '2', '2')).toEqual([{ sectionOrder: 4 }]);
    expect(citationsForRenderedText(cited, ' 2 ', '2')).toEqual([{ sectionOrder: 4 }]);
    expect(citationsForRenderedText(cited, '1', '2')).toEqual([{ sectionOrder: null }]);
    expect(citationsForRenderedText(cited, undefined, '2')).toEqual([{ sectionOrder: null }]);
    expect(citationsForRenderedText(cited, '2', undefined)).toEqual([{ sectionOrder: null }]);
  });
});
