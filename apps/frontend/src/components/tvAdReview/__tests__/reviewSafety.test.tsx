// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../types';
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://review.example.test';
});
const state = vi.hoisted(() => ({
  auth: {
    user: { id: 'admin' } as { id: string } | null,
    accessToken: 'test-token' as string | null,
  },
  access: 'allowed',
  request: vi.fn(),
}));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => state.auth }));
vi.mock('../../../hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ state: state.access }),
}));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../../components/search/searchPieces', () => ({
  SearchPageShell: ({ hero, children }: any) => (
    <main>
      {hero}
      {children}
    </main>
  ),
}));
vi.mock('../../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../../screens/redesign/NotFoundScreen', () => ({ NotFoundScreen: () => <p>404</p> }));
vi.mock('../../candidates/CandidateControls', () => ({
  CandidateLink: () => null,
  CandidateButton: ({ label, accessibilityLabel, onPress, disabled, busy }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled || busy} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock('../ReviewImage', () => ({
  ReviewImage: ({ label, onLoaded }: any) => {
    useEffect(() => {
      onLoaded?.();
    }, [label]);
    return <div>{label}</div>;
  },
}));
vi.mock('../api', async (original) => ({
  ...(await original<any>()),
  reviewRequest: (...args: any[]) => state.request(...args),
}));
import { CheckedReview } from '../CheckedReview';
import { FolderMetadata } from '../FolderMetadata';
import { PrepareReview } from '../PrepareReview';
import { AdminPoliticalAdsScreen } from '../../../screens/redesign/AdminPoliticalAdsScreen';
import { ApiError } from '../../../data/api';

const review: ReviewPayload = {
  publication: {
    id: 'copy-1',
    facility_id: '28010',
    file_id: 'file-1',
    content_hash: 'a'.repeat(64),
    status: 'draft',
    safe_title: 'Safe order',
    safe_folder: 'Safe folder',
    category: 'state',
    safe_pages: [{ page: 1, text: 'Agency: Example Agency', text_status: 'readable' }],
    fingerprint: 'exact-artifact-fingerprint',
    created_at: '2026-10-13T12:00:00Z',
    reviewed_at: null,
    pages: [{ page: 1, width: 612, height: 792 }],
  },
  facts: [],
  connections: [],
  events: [],
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.access = 'allowed';
  state.auth = { user: { id: 'admin' }, accessToken: 'test-token' };
  state.request.mockReset().mockResolvedValue({ rows: [], total: 0, page: 1, page_size: 25 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}
function button(text: string) {
  return Array.from(host.querySelectorAll('button')).find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent) === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(label: string, value: string) {
  const input = host.querySelector(`[aria-label="${label}"]`) as
    HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function screen() {
  return <AdminPoliticalAdsScreen navigation={{ navigate: vi.fn() } as any} />;
}

describe('administrator TV review safety', () => {
  it('sends candidate stage, printed role and inspected fingerprint through the authenticated API', async () => {
    const actual = await vi.importActual<typeof import('../api')>('../api');
    state.request.mockImplementation(actual.reviewRequest);
    const fetchMock = vi.fn().mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify(
            init.method === 'POST'
              ? { id: 'connection-1', status: 'checked' }
              : {
                  label: 'Example Candidate',
                  target_id: 'candidate-1',
                  target_fingerprint: 'candidate-payer-general',
                  fields: [{ label: 'Role', value: 'payer' }],
                },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const approvedReview = {
      ...review,
      publication: {
        ...review.publication,
        status: 'approved',
        safe_pages: [
          { page: 1, text: 'Payer: Example Candidate', text_status: 'readable' as const },
        ],
      },
    };
    await render(
      <CheckedReview
        token="test-token"
        review={approvedReview}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={(path, data) => {
          void actual.reviewRequest('test-token', path, undefined, data);
        }}
      />,
    );
    const select = async (label: string, value: string) => {
      const element = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
      await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await select('Connection kind', 'candidate');
    await fill('Candidate record ID', 'candidate-1');
    await fill('Election stage', 'general');
    await select('Candidate role printed in the file', 'payer');
    await click('Inspect connection target');
    const [previewUrl, previewInit] = fetchMock.mock.calls[0];
    expect(previewUrl).toContain('election_stage=general');
    expect(previewUrl).toContain('role=payer');
    expect(previewInit.cache).toBe('no-store');
    await fill('Connection quote from the safe page text', 'Payer: Example Candidate');
    await fill(
      'Connection evidence and printed role',
      'Read payer beside the exact candidate name on page 1',
    );
    const checkbox = Array.from(host.querySelectorAll<HTMLLabelElement>('label'))
      .find((label) => label.textContent?.includes('I checked this exact connection'))!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => checkbox.click());
    expect(button('Save checked connection').disabled).toBe(false);
    await click('Save checked connection');
    const [saveUrl, saveInit] = fetchMock.mock.calls.at(-1)!;
    expect(saveUrl).toBe(
      'https://review.example.test/api/v1/admin/political-ads/copies/copy-1/connections',
    );
    expect(saveInit.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(saveInit.body)).toMatchObject({
      kind: 'candidate',
      target_id: 'candidate-1',
      election_stage: 'general',
      role: 'payer',
      expected_target_fingerprint: 'candidate-payer-general',
      correctness_reviewed: true,
    });
    await select('Candidate role printed in the file', 'advertiser');
    expect(button('Save checked connection').disabled).toBe(true);
    expect(host.textContent).not.toContain('Role: payer');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps campaign-money race context behind its exact preview and separate attestation', async () => {
    state.request.mockResolvedValue({
      label: 'State Senate district 1',
      target_id: 'race-1',
      target_fingerprint: 'race-office-district-year',
      fields: [{ label: 'Year', value: '2026' }],
    });
    const mutation = vi.fn();
    await render(
      <CheckedReview
        token="test-token"
        review={{ ...review, publication: { ...review.publication, status: 'approved' } }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={mutation}
      />,
    );
    const kind = host.querySelector<HTMLSelectElement>('[aria-label="Connection kind"]')!;
    await act(async () => {
      kind.value = 'election';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fill('Election contest ID', 'race-1');
    await fill('Election stage', 'general');
    await fill('Campaign-money office (optional)', 'State Senate');
    await fill('Campaign-money district (when applicable)', '1');
    await click('Inspect connection target');
    expect(state.request.mock.calls[0][1]).toContain('money_office=State+Senate&money_district=1');
    await fill('Connection quote from the safe page text', 'Example Agency');
    await fill('Connection evidence and printed role', 'Synthetic evidence for this exact race');
    const attest = async (text: string) => {
      const box = Array.from(host.querySelectorAll('label'))
        .find((item) => item.textContent?.includes(text))!
        .querySelector<HTMLInputElement>('input')!;
      await act(async () => box.click());
    };
    await attest('I checked this exact connection');
    expect(button('Save checked connection').disabled).toBe(true);
    await attest('I checked that this exact office');
    expect(button('Save checked connection').disabled).toBe(false);
    await click('Save checked connection');
    expect(mutation).toHaveBeenCalledWith(
      '/copies/copy-1/connections',
      expect.objectContaining({
        election_stage: 'general',
        money_office: 'State Senate',
        money_district: '1',
        money_context_reviewed: true,
        expected_target_fingerprint: 'race-office-district-year',
      }),
      expect.any(Function),
    );
    await fill('Campaign-money district (when applicable)', '2');
    expect(button('Save checked connection').disabled).toBe(true);
    expect(host.textContent).not.toContain('Year: 2026');
  });
  it('requires separate privacy approval to retain a corrected value in reader history', async () => {
    const mutation = vi.fn();
    await render(
      <CheckedReview
        token="test-token"
        review={{
          ...review,
          publication: { ...review.publication, status: 'approved' },
          facts: [
            {
              id: 'old-fact',
              field: 'agency_name',
              value: 'Example Agency',
              quote: 'Agency: Example Agency',
              page: 1,
              status: 'checked',
              publication_approved: true,
            },
          ],
        }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={mutation}
      />,
    );
    await click('Correct agency name');
    await fill('Fact review evidence', 'Synthetic correction evidence');
    const attest = async (text: string) => {
      const box = Array.from(host.querySelectorAll('label'))
        .find((item) => item.textContent?.includes(text))!
        .querySelector<HTMLInputElement>('input')!;
      await act(async () => box.click());
    };
    await attest('I checked this fact');
    await click('Save corrected fact');
    expect(mutation.mock.calls[0][1]).toMatchObject({
      history_publication_approved: false,
      history_privacy_reviewed: false,
    });
    await attest('Keep the earlier reviewed value');
    expect(button('Save corrected fact').disabled).toBe(true);
    await attest('I inspected the earlier value');
    await click('Save corrected fact');
    expect(mutation.mock.calls[1][1]).toMatchObject({
      supersedes_id: 'old-fact',
      history_publication_approved: true,
      history_privacy_reviewed: true,
    });
    await fill('Printed value', 'Example');
    expect(button('Save corrected fact').disabled).toBe(true);
    expect(host.textContent).not.toContain('I inspected the earlier value');
  });
  it('requires an explicit exact-agency address association and clears it after edits', async () => {
    const mutation = vi.fn();
    const text = 'Agency: Example Agency. Agency address: Example Agency, 123 Main Street.';
    await render(
      <CheckedReview
        token="test-token"
        review={{
          ...review,
          publication: {
            ...review.publication,
            status: 'approved',
            safe_pages: [{ page: 1, text, text_status: 'readable' }],
          },
          facts: [
            {
              id: 'agency',
              field: 'agency_name',
              value: 'Example Agency',
              quote: 'Agency: Example Agency.',
              page: 1,
              status: 'checked',
              publication_approved: true,
            },
          ],
        }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={mutation}
      />,
    );
    const field = host.querySelector<HTMLSelectElement>('[aria-label="Fact kind"]')!;
    await act(async () => {
      field.value = 'organization_address';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const addressCheck = () =>
      Array.from(host.querySelectorAll('label'))
        .find((item) => item.textContent?.includes('I checked that this address belongs'))!
        .querySelector<HTMLInputElement>('input')!;
    expect(addressCheck().disabled).toBe(true);
    await fill('Printed value', '123 Main Street');
    await fill(
      'Exact quote from the safe page text',
      'Agency address: Example Agency, 123 Main Street.',
    );
    await fill('Printed role', 'Agency address');
    await fill('Organization named in the address quote', 'Example Agency');
    await fill('Fact review evidence', 'Synthetic address association');
    expect(addressCheck().disabled).toBe(false);
    const correctness = Array.from(host.querySelectorAll('label'))
      .find((item) => item.textContent?.includes('I checked this fact'))!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => correctness.click());
    await click('Save checked fact');
    expect(mutation.mock.calls[0][1].agency_address_reviewed).toBe(false);
    await act(async () => addressCheck().click());
    await click('Save checked fact');
    expect(mutation.mock.calls[1][1]).toMatchObject({
      agency_address_reviewed: true,
      organization_name: 'Example Agency',
      role: 'Agency address',
    });
    await fill('Printed role', 'Billing recipient');
    expect(addressCheck().checked).toBe(false);
    expect(button('Save checked fact').disabled).toBe(true);
  });
  it('never requests private queue data for signed-out or ordinary users', async () => {
    state.access = 'signed-out';
    state.auth = { user: null, accessToken: null };
    await render(screen());
    expect(host.textContent).toBe('404');
    expect(state.request).not.toHaveBeenCalled();
    state.access = 'restricted';
    state.auth = { user: { id: 'ordinary' }, accessToken: 'other' };
    await render(screen());
    expect(host.textContent).toBe('404');
    expect(state.request).not.toHaveBeenCalled();
  });
  it('clears private content and ignores late queue responses after sign-out', async () => {
    let resolve!: (value: unknown) => void;
    state.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render(screen());
    const signal = state.request.mock.calls[0][2] as AbortSignal;
    state.access = 'signed-out';
    state.auth = { user: null, accessToken: null };
    await render(screen());
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({ rows: [{ name: 'private sentinel' }], total: 1, page: 1, page_size: 25 }),
    );
    expect(host.textContent).toBe('404');
  });
  it('removes the full review surface when the next request denies access', async () => {
    state.request.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    await render(screen());
    expect(host.textContent).toBe('404');
  });
  it('requires separate privacy attestations and sends the exact prepared fingerprint', async () => {
    const mutation = vi.fn();
    await render(
      <CheckedReview
        token="test-token"
        review={review}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={mutation}
      />,
    );
    expect(button('Approve this exact copy').disabled).toBe(true);
    await fill('Copy approval evidence', 'All prepared pages reviewed');
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      boxes[0].click();
      boxes[1].click();
    });
    expect(button('Approve this exact copy').disabled).toBe(true);
    await act(async () => boxes[2].click());
    await click('Approve this exact copy');
    expect(mutation).toHaveBeenCalledWith(
      '/copies/copy-1/approve',
      expect.objectContaining({
        expected_fingerprint: 'exact-artifact-fingerprint',
        privacy_reviewed: true,
        metadata_reviewed: true,
        text_reviewed: true,
      }),
    );
  });
  it('resets fact attestations after editing an approved fact value', async () => {
    await render(
      <CheckedReview
        token="test-token"
        review={{ ...review, publication: { ...review.publication, status: 'approved' } }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={vi.fn()}
      />,
    );
    await fill('Printed value', 'Example Agency');
    await fill('Exact quote from the safe page text', 'Agency: Example Agency');
    await fill('Fact review evidence', 'Read page 1');
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    expect(button('Save checked fact').disabled).toBe(false);
    await fill('Printed value', 'Something else');
    expect(button('Save checked fact').disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
  });
  it('does not prefill safe text from private machine reading and allows decimal redaction positions', async () => {
    const version = {
      document: {
        facility_id: '28010',
        file_id: 'file-1',
        content_hash: 'a'.repeat(64),
        name: 'Private title',
        call_sign: 'KSTP-TV',
        folder_path: 'private',
        folder_id: 'f',
        first_saved_at: '2026-10-13',
        uploaded_at: null,
      },
      pages: [{ page: 1, text: 'Private sentinel', text_status: 'readable' }],
      draft_facts: [],
      copies: [],
      page_count: 1,
    };
    await render(
      <PrepareReview
        token="test-token"
        version={version}
        busy={false}
        onPrepare={vi.fn()}
        onDenied={vi.fn()}
      />,
    );
    expect(
      (host.querySelector('[aria-label="Safe text for page 1"]') as HTMLTextAreaElement).value,
    ).toBe('');
    await click('Add withheld area');
    await fill('Left for area 1', '0.');
    expect((host.querySelector('[aria-label="Left for area 1"]') as HTMLInputElement).value).toBe(
      '0.',
    );
    await fill('Left for area 1', '0.25');
    expect((host.querySelector('[aria-label="Left for area 1"]') as HTMLInputElement).value).toBe(
      '0.25',
    );
  });
  it('metadata-only approval cannot approve page images or text', async () => {
    const mutation = vi.fn();
    await render(
      <CheckedReview
        token="test-token"
        review={{
          ...review,
          publication: {
            ...review.publication,
            metadata_only: true,
            safe_pages: [],
            pages: [],
          },
        }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={mutation}
      />,
    );
    expect(button('Approve this exact copy')).toBeUndefined();
    expect(host.textContent).not.toContain('Loading page image');
    await fill('Metadata approval evidence', 'Title and folder privacy reviewed');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Approve metadata only');
    expect(mutation).toHaveBeenCalledWith('/copies/copy-1/approve-metadata', {
      expected_fingerprint: 'exact-artifact-fingerprint',
      metadata_reviewed: true,
      evidence: 'Title and folder privacy reviewed',
    });
  });
  it('requires every prepared page to load before full copy approval', async () => {
    await render(
      <CheckedReview
        token="test-token"
        review={{
          ...review,
          publication: {
            ...review.publication,
            pages: [
              { page: 1, width: 612, height: 792 },
              { page: 2, width: 612, height: 792 },
            ],
          },
        }}
        busy={false}
        onDenied={vi.fn()}
        onEdit={vi.fn()}
        onMutation={vi.fn()}
      />,
    );
    await fill('Copy approval evidence', 'All pages privacy reviewed');
    await act(async () =>
      host
        .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        .forEach((input) => input.click()),
    );
    expect(button('Approve this exact copy').disabled).toBe(true);
    await click('Next prepared page');
    expect(button('Approve this exact copy').disabled).toBe(false);
  });
  it('permits reviewing an empty folder relationship without a file copy', async () => {
    const folder = {
      facility_id: '28010',
      folder_id: 'empty-folder',
      content_hash: 'b'.repeat(64),
      source_url: 'https://publicfiles.fcc.gov/example',
      stored_at: '2026-10-13',
      label: 'Empty folder',
      path: '2026/State/Empty folder',
    };
    state.request.mockImplementation((_token, path) =>
      Promise.resolve(
        path.startsWith('/folders?')
          ? { rows: [folder], total: 1, page: 1, page_size: 25 }
          : {
              ...folder,
              text: 'Example Committee',
              approvals: [
                {
                  id: 'folder-approval',
                  status: 'approved',
                  safe_label: 'Empty folder',
                  safe_path: folder.path,
                  fingerprint: 'folder-hash',
                },
              ],
            },
      ),
    );
    await render(<FolderMetadata token="test-token" onDenied={vi.fn()} />);
    await click('Review folder Empty folder');
    await click('Open approved folder label: Empty folder');
    expect(host.textContent).toContain('Check this folder’s committee relationship');
    expect(
      host.querySelector('[aria-label="Folder committee registration number"]'),
    ).not.toBeNull();
  });

  it('uses a suggestion only to fill the form; saving still needs the reviewer’s own checks', async () => {
    const onMutation = vi.fn();
    const text = 'Advertiser: Example Committee\nAgency: Example Agency';
    const approvedReview = {
      ...review,
      publication: {
        ...review.publication,
        status: 'approved',
        safe_pages: [{ page: 1, text, text_status: 'readable' as const }],
      },
    };
    const evidence = {
      field: 'advertiser',
      value: 'Example Committee',
      page: 1,
      quote: 'Advertiser: Example Committee',
      source: 'machine_read' as const,
    };
    const dismissed = new Set<string>();
    const props = {
      token: 'test-token',
      review: approvedReview,
      busy: false,
      onDenied: vi.fn(),
      onEdit: vi.fn(),
      onMutation,
      suggestions: {
        copyId: 'copy-1',
        busy: false,
        error: false,
        data: {
          copy_id: 'copy-1',
          facts: [
            {
              field: 'agency_name',
              machine_field: 'agency_name',
              value: 'Example Agency',
              page: 1,
              quote: 'Agency: Example Agency',
              in_safe_text: true,
              already_checked: false,
            },
          ],
          committees: [
            {
              registration_number: '18000',
              name: 'Example Committee',
              filer_kind: 'candidate_committee',
              terminated: false,
              evidence,
              in_safe_text: true,
              already_connected: false,
            },
          ],
          expenses: { suggestions: [], reason: 'extraction_not_found', truncated: false },
        },
      },
      dismissed,
      onDismiss: (key: string) => dismissed.add(key),
    };
    await render(<CheckedReview {...props} />);
    expect(host.textContent).toContain('Suggested · Not checked');
    expect(host.textContent).toContain('No machine reading is saved for this file');
    await click('Use suggestion: agency name Example Agency');
    const value = host.querySelector<HTMLInputElement>('[aria-label="Printed value"]')!;
    const quote = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Exact quote from the safe page text"]',
    )!;
    expect(value.value).toBe('Example Agency');
    expect(quote.value).toBe('Agency: Example Agency');
    expect(onMutation).not.toHaveBeenCalled();
    expect(button('Save checked fact').disabled).toBe(true);
    await fill('Fact review evidence', 'Read the agency line on page 1');
    expect(button('Save checked fact').disabled).toBe(true);
    const checkbox = Array.from(host.querySelectorAll<HTMLLabelElement>('label'))
      .find((label) => label.textContent?.includes('I checked this fact against'))!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => checkbox.click());
    await click('Save checked fact');
    expect(onMutation.mock.calls[0][1]).toMatchObject({
      field: 'agency_name',
      value: 'Example Agency',
      quote: 'Agency: Example Agency',
      page: 1,
      correctness_reviewed: true,
      publication_approved: false,
    });

    await click('Use suggestion: committee Example Committee');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Committee registration number"]')!.value,
    ).toBe('18000');
    expect(
      host.querySelector<HTMLInputElement>(
        '[aria-label="Connection role printed in the source (if stated)"]',
      )!.value,
    ).toBe('Advertiser');
    expect(button('Save checked connection').disabled).toBe(true);
    expect(onMutation).toHaveBeenCalledTimes(1);

    await click('Dismiss suggestion: committee Example Committee');
    await render(<CheckedReview {...props} dismissed={new Set(dismissed)} />);
    expect(button('Use suggestion: committee Example Committee')).toBeUndefined();
    expect(button('Show 1 dismissed suggestion')).toBeDefined();
  });

  it('labels files suggested first with the checked evidence behind them', async () => {
    state.request.mockResolvedValue({
      rows: [
        {
          facility_id: '28010',
          file_id: 'file-1',
          content_hash: 'a'.repeat(64),
          name: 'Order 1',
          call_sign: 'KSTP-TV',
          folder_path: 'Political Files/2026',
          uploaded_at: null,
          first_saved_at: '2026-10-13T12:00:00Z',
          page_count: 1,
          status: 'unprepared',
          suggested_first: true,
          checked_agency_names: ['Example Agency'],
          folder_committees: ['Example Committee'],
        },
      ],
      total: 3,
      first_total: 1,
      page: 1,
      page_size: 25,
    });
    await render(screen());
    expect(host.textContent).toContain('3 source versions · 1 suggested first · page 1');
    expect(host.textContent).toContain('Agency name already checked: Example Agency');
    expect(host.textContent).toContain('Folder checked as relating to Example Committee');
  });
});
