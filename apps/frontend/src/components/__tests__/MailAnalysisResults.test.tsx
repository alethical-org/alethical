// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { MailAnalysis, SavedMailSubmission } from '../../data/mailAnalysis';
import type { useMailAnalysis } from '../../hooks/useMailAnalysis';

const state = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock('../../hooks/useMailAnalysis', () => ({ useMailAnalysis: state.use }));
import { MailAnalysisResults } from '../MailAnalysisResults';

const submission: SavedMailSubmission = { id: 'private-id', token: 'private-token', photos: {} };
const result: MailAnalysis = {
  status: 'ready',
  can_retry: false,
  matching_mailers: { count: null },
  payers: [
    {
      side: 'back',
      quote: 'Paid for by Examp1e <Fund>\nWords cut o',
      payer_text: 'Examp1e',
      edge_warning: true,
      official_organization: null,
      candidates: [
        {
          name: 'Example Fund',
          registration_number: '10001',
          scope: 'candidate_record',
          basis: 'similar_committee_name',
          source_url: 'https://cfb.mn.gov/example',
        },
      ],
      related_records: [
        {
          name: 'Related Fund',
          registration_number: '10002',
          scope: 'related_record',
          basis: 'same_website',
          source_url: 'https://cfb.mn.gov/related',
        },
      ],
    },
  ],
  sides: [
    {
      side: 'front',
      status: 'read',
      text: 'Front machine words',
      complete: false,
      disclosures: [],
    },
    {
      side: 'back',
      status: 'partial',
      text: 'Back machine words',
      complete: false,
      disclosures: [],
    },
  ],
};
let current: ReturnType<typeof useMailAnalysis>;
let container: HTMLDivElement;
let root: Root;
const onStartAgain = vi.fn();
async function render() {
  state.use.mockReturnValue(current);
  await act(async () =>
    root.render(createElement(MailAnalysisResults, { submission, onStartAgain })),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  current = {
    result: structuredClone(result),
    error: null,
    retrying: false,
    refreshing: false,
    retry: vi.fn(),
    refresh: vi.fn(),
  };
  onStartAgain.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('moves focus from a disappearing retry to the result heading only while that retry owns focus', async () => {
  current.result = { ...result, status: 'partial', can_retry: true };
  await render();
  const retry = container
    .querySelector('#mail-machine-text')!
    .parentElement!.querySelector('button.results-retry') as HTMLButtonElement;
  retry.focus();
  current.result = {
    ...result,
    status: 'ready',
    can_retry: false,
    sides: result.sides.map((side) => ({ ...side, status: 'read' })),
  };
  await render();
  expect(document.activeElement).toBe(container.querySelector('#mail-machine-text'));

  current.result = { ...result, status: 'partial', can_retry: true };
  await render();
  (
    container
      .querySelector('#mail-machine-text')!
      .parentElement!.querySelector('button.results-retry') as HTMLButtonElement
  ).focus();
  const photo = container.querySelector('button.view-photo') as HTMLButtonElement;
  photo.focus();
  current.result = { ...result, status: 'ready', can_retry: false };
  await render();
  expect(document.activeElement).toBe(photo);
});

it('returns a focused network recovery to the text section while reading continues', async () => {
  current.result = null;
  current.error = 'unavailable';
  await render();
  (container.querySelector('button.results-retry') as HTMLButtonElement).focus();
  current.refreshing = true;
  await render();
  expect(document.activeElement?.textContent).toBe('Trying again…');
  current.error = null;
  current.refreshing = false;
  current.result = { ...result, status: 'pending', payers: [], sides: [] };
  await render();
  expect(document.activeElement).toBe(container.querySelector('.reading'));
  expect(container.textContent).toContain('Reading your mail');
  expect(container.textContent).not.toContain('Reading the front');
  expect(container.textContent).not.toContain('Reading the back');
});

it.each(['expired', 'failed'] as const)(
  'keeps a useful focus target after empty %s recovery',
  async (outcome) => {
    current.result = null;
    current.error = 'unavailable';
    await render();
    (container.querySelector('button.results-retry') as HTMLButtonElement).focus();
    current.error = outcome === 'expired' ? 'expired' : null;
    current.result =
      outcome === 'failed' ? { ...result, status: 'failed', sides: [], payers: [] } : null;
    await render();
    expect(document.activeElement?.textContent).toBe(
      outcome === 'expired' ? 'Start again' : 'We couldn’t load these results',
    );
  },
);

it('keeps exact machine-read evidence separate from possible and related identities', async () => {
  await render();
  expect(container.querySelector('blockquote')?.textContent).toBe(`“${result.payers[0].quote}”`);
  expect(container.querySelector('blockquote')?.textContent).not.toContain('Example Fund');
  const headings = [...container.querySelectorAll('h2')].map((x) => x.textContent);
  expect(headings).toEqual([
    'Possible matches',
    'Related records',
    'Printed payer',
    'Text from your mail',
  ]);
  expect(container.textContent).toContain('Similar name');
  expect(container.textContent).not.toContain('Same website');
  expect(container.textContent).toContain('From the back');
  expect(container.textContent).not.toContain('Name and address match');
  expect(container.textContent).not.toContain(submission.token);
});

it('lets an expired session start again while retaining readable results until reset', async () => {
  current.error = 'expired';
  await render();
  expect(container.textContent).toContain('This upload session is no longer available');
  expect(container.querySelector('blockquote')?.textContent).toContain(result.payers[0].quote);
  const start = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Start again',
  )!;
  await act(async () => start.click());
  expect(onStartAgain).toHaveBeenCalledOnce();
  expect(current.refresh).not.toHaveBeenCalled();
});

it.each([null, 1, 12])('keeps the internal matching count %s out of the results', async (count) => {
  current.result!.matching_mailers.count = count;
  await render();
  expect(container.querySelector('.count')).toBeNull();
  expect(container.textContent).not.toContain('Matching mailers');
  expect(current.result!.matching_mailers.count).toBe(count);
});

it('opens text in place with a separate accessible photo button', async () => {
  await render();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="mail-text-front"]')!;
  const text = container.querySelector<HTMLDivElement>('#mail-text-front')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(text.hidden).toBe(true);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(text.hidden).toBe(false);
  expect(text.textContent).toBe('Front machine words');
  expect(toggle.querySelector('button')).toBeNull();
  expect(container.querySelector('button[aria-label="View front photo"]')).not.toBeNull();
});

it('opens official links in a safe new tab and omits unsafe URLs', async () => {
  await render();
  const links = [...container.querySelectorAll('a')];
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
  }
  current.result!.payers[0].candidates[0].source_url = 'javascript:alert(1)';
  await render();
  expect(container.querySelectorAll('a')).toHaveLength(1);
});

it('shows at most five source rows, preserves missing money and payment qualifications, and omits an absent block', async () => {
  current.result!.payers[0].candidates[0].records = {
    state: 'available',
    registration_number: '10001',
    year: 2026,
    received: {
      state: 'reported',
      payments: Array.from({ length: 6 }, (_, index) => ({
        amount: index === 0 ? null : '-10.7500',
        record_number: index + 1,
        contributor: `Contributor ${index}`,
        received_on: '2026-10-15',
        receipt_type: index === 1 ? 'Loan' : 'Contribution',
        in_kind: index === 2 ? 'Yes' : 'No',
        in_kind_description: index === 2 ? 'Printing' : null,
      })),
      has_more: true,
      total_payments: 9,
      source_url: 'https://cfb.mn.gov/contributions',
      fetched_at: '2026-11-10T00:17:45Z',
    },
    paid: {
      state: 'not_reported',
      payments: [],
      has_more: false,
      total_payments: 0,
      source_url: 'https://cfb.mn.gov/payments',
      fetched_at: null,
    },
    independent_spending: {
      state: 'reported',
      payments: [
        {
          amount: '95.6000',
          unpaid_amount: '7.2500',
          record_number: 99,
          vendor_name: 'Example Printer',
          affected_committee_name: 'Example Candidate',
          stance: 'Against',
          paid_on: '2026-10-19',
          purpose: 'DIRECT MAIL: PRINTING',
        },
      ],
      has_more: false,
      total_payments: 1,
      source_url: 'https://cfb.mn.gov/independent',
      fetched_at: null,
    },
  };
  await render();
  const card = container.querySelector('#mail-possible-matches')!.parentElement!;
  expect(card.querySelectorAll('.payment-row')).toHaveLength(6);
  expect(card.textContent).toContain('Latest 5 of 9 records');
  expect(card.textContent).not.toContain('Latest 5 of 9 records · 2026');
  expect(card.textContent).not.toContain('Contributor 5');
  expect(card.textContent).toContain('Not reported');
  expect(card.textContent).not.toContain('$0');
  expect(card.textContent).toContain('-$10');
  expect(card.textContent).toContain('Loan');
  expect(card.textContent).toContain('In kind: Printing');
  expect(card.textContent).toContain('$7 of it unpaid');
  expect(card.textContent).toContain('Against Example Candidate');
  expect(card.textContent).toContain('Paid to Example Printer');
  expect(card.textContent).toContain('Purpose “DIRECT MAIL: PRINTING”');
  expect(card.textContent).toContain('Retrieved Nov 9, 2026');
  expect(card.querySelector('a[href="https://cfb.mn.gov/payments"]')).toBeNull();
  expect(card.textContent).not.toContain('No records found');
  expect(
    card.querySelector('a[href="https://cfb.mn.gov/contributions"]')?.getAttribute('aria-label'),
  ).toContain('Minnesota Campaign Finance Board, opens in a new tab');
});

it('keeps old rows and source dates visible when their refresh failed', async () => {
  current.result!.status = 'partial';
  current.result!.can_retry = true;
  current.result!.payers[0].candidates[0].records = {
    state: 'available',
    registration_number: '10001',
    refresh_failed: true,
    year: 2026,
    received: {
      state: 'reported',
      payments: [{ amount: '10.5000', record_number: 1, contributor: 'Earlier contributor' }],
      has_more: false,
      total_payments: 1,
      source_url: 'https://cfb.mn.gov/contributions',
      fetched_at: '2026-10-20T18:00:00Z',
    },
  };
  await render();
  expect(container.textContent).toContain('We couldn’t refresh these records');
  expect(container.textContent).toContain('Earlier contributor');
  expect(container.textContent).toContain('Retrieved Oct 20, 2026');
  current.result!.can_retry = false;
  await render();
  expect(
    [...container.querySelectorAll('button')].some((button) => button.textContent === 'Try again'),
  ).toBe(false);
});

it('claims no payer only after both sides were read, never claims an exhaustive public-record search', async () => {
  current.result!.payers = [];
  current.result!.sides[1].status = 'unreadable';
  current.result!.sides[1].text = '';
  await render();
  expect(container.textContent).not.toContain('No payer found');
  expect(container.textContent).toContain('We couldn’t read this photo');
  expect(container.querySelector('[aria-controls="mail-text-back"]')).toBeNull();
  current.result!.sides[1].status = 'read';
  await render();
  expect(container.textContent).toContain('No payer found');
  expect(container.textContent).not.toContain('No public records found');
});

it('keeps the retry button busy and old text usable while the queued retry is processing', async () => {
  current.result!.status = 'processing';
  current.retrying = true;
  await render();
  const retry = [...container.querySelectorAll('button')].filter(
    (button) => button.textContent === 'Trying again…',
  );
  expect(retry.length).toBeGreaterThan(0);
  expect(retry.every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
  expect(container.textContent).toContain('Back machine words');
  expect(container.textContent).not.toContain('Reading your mail');
});

function supportedFund() {
  const source = 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
  const block = {
    state: 'reported' as const,
    has_more: true,
    total_payments: 26,
    fetched_at: '2026-11-10T00:17:45Z',
  };
  const fund = current.result!.payers[0].related_records[0];
  Object.assign(fund, {
    name: 'Our America Minnesota Political Fund',
    registration_number: '30807',
    domain: 'joinouramerica.org',
    checked_on: '2026-11-09',
    records: {
      state: 'available',
      registration_number: '30807',
      year: 2026,
      received: {
        ...block,
        source_url: `${source}?download=-2113865252`,
        payments: [
          {
            amount: '5945.85',
            record_number: 487344,
            contributor: 'Our America',
            received_on: '2026-10-19',
          },
          {
            amount: '6143.24',
            record_number: 349548,
            contributor: 'Our America',
            received_on: '2026-10-18',
          },
        ],
      },
      paid: { ...block, state: 'not_reported', payments: [], source_url: null },
      independent_spending: {
        ...block,
        fetched_at: '2026-11-10T00:18:13Z',
        source_url: `${source}?download=-617535497`,
        payments: [
          'Advertising - general: Digital Advertising Service',
          'Telephone: Texting - Lisa Demuth for Governor',
        ].map((purpose, index) => ({
          amount: '5945.85',
          unpaid_amount: '0.0000',
          record_number: 23758 + index,
          paid_on: '2026-10-19',
          vendor_name: 'Bilander Media',
          affected_committee_name: 'Demuth, Lisa Gov Committee',
          stance: 'For',
          purpose,
        })),
      },
    },
  });
  return fund;
}

it('shows the approved summary only beside records that support every claim', async () => {
  supportedFund();
  await render();
  const summary = container.querySelector('.record-summary')!;
  expect(summary.textContent).toBe(
    'Records show contributions from Our America and payments to Bilander Media for digital ads and texts supporting Lisa Demuth. They don’t identify who produced this mailer.',
  );
  expect(summary.previousElementSibling?.textContent).toBe('Our America Minnesota Political Fund');
  expect(summary.nextElementSibling?.textContent).toContain('Website on the mail and state record');
});

it.each([
  'registration',
  'fund name',
  'contributor',
  'vendor',
  'candidate',
  'stance',
  'digital',
  'texts',
  'refresh',
  'missing block',
  'unavailable',
  'zero',
  'fully unpaid',
  'unknown unpaid',
])('omits the summary when %s evidence is missing or contradictory', async (change) => {
  const fund = supportedFund();
  const records = fund.records!;
  if (change === 'registration') fund.registration_number = '99999';
  if (change === 'fund name') fund.name = 'Another Fund';
  if (change === 'contributor')
    records.received!.payments.forEach((row) => (row.contributor = 'Another contributor'));
  if (change === 'vendor')
    records.independent_spending!.payments.forEach((row) => (row.vendor_name = 'Another vendor'));
  if (change === 'candidate')
    records.independent_spending!.payments.forEach(
      (row) => (row.affected_committee_name = 'Another candidate'),
    );
  if (change === 'stance')
    records.independent_spending!.payments.forEach((row) => (row.stance = 'Against'));
  if (change === 'digital') records.independent_spending!.payments[0].purpose = 'Direct mail';
  if (change === 'texts') records.independent_spending!.payments[1].purpose = 'Printing';
  if (change === 'refresh') records.refresh_failed = true;
  if (change === 'missing block') delete records.received;
  if (change === 'unavailable') records.state = 'unavailable';
  if (change === 'zero') records.received!.payments.forEach((row) => (row.amount = '0'));
  if (change === 'fully unpaid')
    records.independent_spending!.payments.forEach((row) => (row.unpaid_amount = row.amount));
  if (change === 'unknown unpaid')
    records.independent_spending!.payments.forEach((row) => delete row.unpaid_amount);
  await render();
  expect(container.querySelector('.record-summary')).toBeNull();
});

it('moves shared identities above their rows and restores each differing identity beside its row', async () => {
  const fund = supportedFund();
  await render();
  const card = container.querySelector('#mail-related-records')!.parentElement!;
  const rows = [...card.querySelectorAll('.payment-row')];
  expect(card.querySelectorAll('.record-context')).toHaveLength(2);
  expect(card.textContent?.match(/From Our America/g)).toHaveLength(1);
  expect(card.textContent?.match(/Paid to Bilander Media/g)).toHaveLength(1);
  expect(card.textContent?.match(/For Demuth, Lisa Gov Committee/g)).toHaveLength(1);
  expect(rows.every((row) => !row.textContent?.includes('Bilander Media'))).toBe(true);
  expect(rows[2].textContent).toContain(
    'Purpose “Advertising - general: Digital Advertising Service”',
  );
  fund.records!.received!.payments[1].contributor = 'Another contributor';
  fund.records!.independent_spending!.payments[1].vendor_name = 'Another vendor';
  fund.records!.independent_spending!.payments[1].stance = 'Against';
  await render();
  expect(card.querySelectorAll('.record-context')).toHaveLength(0);
  expect(card.querySelectorAll('.payment-row')[0].textContent).toContain('From Our America');
  expect(card.querySelectorAll('.payment-row')[1].textContent).toContain(
    'From Another contributor',
  );
  expect(card.querySelectorAll('.payment-row')[2].textContent).toContain(
    'For Demuth, Lisa Gov Committee',
  );
  expect(card.querySelectorAll('.payment-row')[3].textContent).toContain(
    'Against Demuth, Lisa Gov Committee',
  );
  expect(card.querySelectorAll('.payment-row')[3].textContent).toContain('Paid to Another vendor');
});

it('shares the retrieved date only for matching dates, while keeping each registration check', async () => {
  const fund = supportedFund();
  await render();
  const card = container.querySelector('#mail-related-records')!.parentElement!;
  expect(card.querySelectorAll('.retrieved')).toHaveLength(1);
  expect(card.querySelector('.retrieved')?.closest('.record-group')).toBeNull();
  expect(card.textContent).toContain('Checked Nov 9, 2026');
  fund.records!.independent_spending!.fetched_at = '2026-11-10T12:00:00Z';
  await render();
  expect(card.querySelectorAll('.record-group .retrieved')).toHaveLength(2);
  expect(card.textContent).toContain('Retrieved Nov 9, 2026');
  expect(card.textContent).toContain('Retrieved Nov 10, 2026');
  fund.records!.received!.payments[0].received_on = null;
  await render();
  expect(card.textContent).toContain('Latest 2 of 26 records · 2026');
});

it('identifies supported downloads and shared scope without turning unknown URLs into CSV claims', async () => {
  const fund = supportedFund();
  await render();
  const card = container.querySelector('#mail-related-records')!.parentElement!;
  expect(card.querySelector('.record-group h4 a')).toBeNull();
  const links = [...card.querySelectorAll<HTMLAnchorElement>('.record-downloads a')];
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toMatch(
      /^Download (contributions|independent spending) \(CSV\), Minnesota Campaign Finance Board, opens in a new tab$/,
    );
    expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toBe(
      'State files cover all filers from 2015 to present. Downloads may take a moment.',
    );
  }
  fund.records!.received!.source_url = 'https://cfb.mn.gov/new-source';
  await render();
  const unknown = card.querySelector('a[href="https://cfb.mn.gov/new-source"]')!;
  expect(unknown.textContent).toBe('View contributions received source');
  expect(unknown.hasAttribute('aria-describedby')).toBe(false);
});

it('shows only a verified website domain with matching evidence', async () => {
  const fund = supportedFund();
  await render();
  const website = container.querySelector<HTMLAnchorElement>(
    'a[href="https://joinouramerica.org"]',
  )!;
  expect(website.textContent).toBe('joinouramerica.org');
  expect(website.target).toBe('_blank');
  for (const domain of [
    'javascript:alert(1)',
    'joinouramerica.org/path',
    'joinouramerica.org@evil.test',
    '',
  ]) {
    fund.domain = domain;
    await render();
    expect(container.querySelector('.record-website')).toBeNull();
  }
  fund.domain = 'joinouramerica.org';
  fund.basis = 'same_committee_name';
  await render();
  expect(container.querySelector('.record-website')).toBeNull();
});

it('opens the contribution explanation without moving focus and uses a distinct controlled region', async () => {
  supportedFund();
  await render();
  const button = container.querySelector<HTMLButtonElement>('.contribution-toggle')!;
  const answer = document.getElementById(button.getAttribute('aria-controls')!)!;
  expect(button.textContent).toBe('What counts as a contribution?');
  expect(answer.hidden).toBe(true);
  button.focus();
  await act(async () => button.click());
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(button);
  expect(answer.hidden).toBe(false);
  expect(answer.textContent).toBe(
    'An organization can also assign its own money to its political fund. Minnesota records this as a contribution.',
  );
  await act(async () => button.click());
  expect(answer.hidden).toBe(true);
});

it('keeps derived text and local recovery, with one notice and no legacy gap markers', async () => {
  current.result!.status = 'partial';
  current.result!.can_retry = true;
  current.result!.sides[1].display_text = 'John Smith will\n[Unreadable]\nraise taxes\n\nVote 42';
  current.result!.sides[1].reading_notice = 'Some text could not be read';
  await render();
  const back = container.querySelector<HTMLElement>('#mail-text-back')!;
  const side = back.closest('.text-side')!;
  expect(container.querySelector('.reading-notice')?.textContent).toContain(
    'Some text couldn’t be read',
  );
  expect(side.querySelector('button.results-retry')).not.toBeNull();
  expect(back.textContent).toBe('Vote 42');
  expect(back.querySelector('.text-gap')).toBeNull();
  expect(current.result!.sides[1].text).toBe('Back machine words');
  expect(back.hidden).toBe(true);
  current.result!.sides[1].status = 'unreadable';
  current.result!.sides[1].display_text = '';
  await render();
  const failure = [...container.querySelectorAll('.results-failure')].find(
    (node) => node.textContent === 'We couldn’t read this photo',
  )!;
  expect(failure.closest('.text-side')?.querySelector('button.results-retry')).not.toBeNull();
  expect(container.querySelector('#mail-text-front')?.textContent).toBe('Front machine words');
  expect(container.querySelector('blockquote')?.textContent).toContain(result.payers[0].quote);
});

it('places records before the printed payer, immediately followed by captured text', async () => {
  await render();
  expect([...container.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual([
    'Possible matches',
    'Related records',
    'Printed payer',
    'Text from your mail',
  ]);
});

it('shows corrected payer punctuation without changing the raw evidence', async () => {
  current.result!.payers[0].display_quote = 'Paid for by Example Fund. It is responsible for it.';
  const original = current.result!.payers[0].quote;
  await render();
  expect(container.querySelector('blockquote')?.textContent).toBe(
    '“Paid for by Example Fund. It is responsible for it.”',
  );
  expect(current.result!.payers[0].quote).toBe(original);
});

it('keeps one incompleteness note and omits completed empty text disclosures', async () => {
  current.result!.sides[0] = {
    ...current.result!.sides[0],
    status: 'partial',
    display_text: '',
    reading_incomplete: true,
  };
  current.result!.sides[1] = {
    ...current.result!.sides[1],
    display_text: 'Cut\nWaste\nFraud',
    reading_incomplete: true,
  };
  await render();
  const section = container.querySelector('#mail-machine-text')!.parentElement!;
  expect(section.querySelector('[aria-controls="mail-text-front"]')).toBeNull();
  expect(section.querySelector('[aria-controls="mail-text-back"]')).not.toBeNull();
  expect(section.textContent?.match(/Some text couldn’t be read/g)).toHaveLength(1);
  expect(section.textContent).not.toContain('[Unreadable]');
  expect(section.querySelector('button[aria-label="View front photo"]')).not.toBeNull();
});

it('shows records loading without reporting a failure and preserves an open text block', async () => {
  current.result!.status = 'processing';
  current.result!.snapshot_version = 1;
  current.result!.progress = {
    completed_sides: ['front'],
    active_sides: ['back'],
    reading_complete: false,
    records_complete: false,
  };
  current.result!.sides = [current.result!.sides[0]];
  current.result!.payers[0].related_records = [];
  current.result!.payers[0].candidates[0].records = {
    state: 'loading',
    registration_number: '10001',
  };
  await render();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="mail-text-front"]')!;
  await act(async () => toggle.click());
  toggle.focus();
  expect(container.textContent).toContain('Reading the back');
  expect(container.textContent).toContain('Finding public records');
  expect(container.textContent).not.toContain('We couldn’t load these results');
  expect(container.textContent).not.toContain('No payer found');
  current.result!.payers[0].candidates[0].records = {
    state: 'available',
    registration_number: '10001',
  };
  await render();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(toggle);
});
