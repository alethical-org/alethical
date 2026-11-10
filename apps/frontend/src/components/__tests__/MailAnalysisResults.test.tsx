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

it('returns a focused network recovery to Reading your mail when results are still queued', async () => {
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
  expect(document.activeElement?.textContent).toBe('Reading your mail');
});

it('keeps exact machine-read evidence separate from possible and related identities', async () => {
  await render();
  expect(container.querySelector('blockquote')?.textContent).toBe(`“${result.payers[0].quote}”`);
  expect(container.querySelector('blockquote')?.textContent).not.toContain('Example Fund');
  const headings = [...container.querySelectorAll('h2')].map((x) => x.textContent);
  expect(headings).toEqual([
    'Printed payer',
    'Possible matches',
    'Related records',
    'Matching mailers',
    'Machine-read text',
  ]);
  expect(container.textContent).toContain('Similar name');
  expect(container.textContent).toContain('Same website');
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

it('keeps unknown and singular counts distinct without people or delivery claims', async () => {
  await render();
  expect(container.querySelector('.count')?.textContent).toBe('Not counted yet');
  current.result = { ...result, matching_mailers: { count: 1 } };
  await render();
  expect(container.querySelector('.count')?.textContent).toBe('1 submission');
  current.result = { ...result, matching_mailers: { count: 12 } };
  await render();
  expect(container.querySelector('.count')?.textContent).toBe('12 submissions');
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
  expect(card.textContent).toContain('Latest 5 of 9 records · 2026');
  expect(card.textContent).not.toContain('Contributor 5');
  expect(card.textContent).toContain('Not reported');
  expect(card.textContent).not.toContain('$0');
  expect(card.textContent).toContain('-$10');
  expect(card.textContent).toContain('Loan');
  expect(card.textContent).toContain('In kind: Printing');
  expect(card.textContent).toContain('$7 of it unpaid');
  expect(card.textContent).toContain('Against Example Candidate');
  expect(card.textContent).toContain('To Example Printer');
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
