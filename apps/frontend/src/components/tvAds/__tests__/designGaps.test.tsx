// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  user: { id: 'admin', isAdmin: true },
  accessToken: 'one',
  isSignedIn: true,
  isLoading: false,
}));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../../data/api', () => ({
  apiRequest: request,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isDesktop: true, isTablet: false }),
}));
import { TVSession } from '../pieces';
import { resultCountLine } from '../Landing';
import { MachineText } from '../MachineText';
import { TVAdConnectionCard } from '../Connected';
import { TVAgency, TVFile, TVFolder, TVStation } from '../Records';

let mount: HTMLDivElement;
let root: Root;
beforeEach(() => {
  request.mockReset();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});
const session = (child: React.ReactNode) => (
  <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>{child}</TVSession.Provider>
);
const links = () => Array.from(mount.querySelectorAll<HTMLAnchorElement>('a'));

describe('count line', () => {
  const base = { q: '', tab: 'folders' as const, page: 1, page_size: 12, capped: false };
  const rows = (n: number) => Array.from({ length: n }, () => ({ key: 'k', label: 'l' }));
  it.each([
    [{ ...base, total: 214, rows: rows(12) }, 'Showing 1–12 of 214 folders'],
    [{ ...base, page: 18, total: 214, rows: rows(10) }, 'Showing 205–214 of 214 folders'],
    [{ ...base, tab: 'agencies' as const, total: 4, rows: rows(4) }, '4 agency names'],
    [{ ...base, tab: 'years' as const, total: 1, rows: rows(1) }, '1 year'],
    [
      { ...base, q: 'lakes', total: 500, capped: true, rows: rows(12) },
      'Showing 1–12 of more than 500 files',
    ],
  ])('reads %j as the drawn line', (result, line) => {
    expect(resultCountLine(result)).toBe(line);
  });
});

describe('machine-read text redactions', () => {
  it('marks withheld names and blank boxes only on an approved copy', async () => {
    const text = 'BUYER: Name withheld\nEMAIL: [Blanked]';
    await act(async () => root.render(<MachineText text={text} query="" redacted />));
    expect(mount.querySelector('.tv-mt-withheld')?.textContent).toBe('Name withheld');
    const blank = mount.querySelector('.tv-mt-blanked')!;
    expect(blank.getAttribute('aria-label')).toBe('Blanked');
    expect(blank.textContent).toBe('');
    expect(mount.textContent).not.toContain('[Blanked]');
    await act(async () => root.render(<MachineText text={text} query="" />));
    expect(mount.querySelector('.tv-mt-withheld')).toBeNull();
    expect(mount.textContent).toContain('[Blanked]');
  });
});

describe('file page', () => {
  const file = {
    key: 'file',
    name: 'Order 4471',
    station: 'KSTP-TV',
    year: 2026,
    category: 'State',
    copy_status: 'approved',
    version_id: 'old',
    current_source_version: 'new',
    newest_approved_version: 'old',
    source_changed: true,
    page_count: 1,
    pages: [],
    versions: [
      { id: 'new', first_saved_at: '2026-10-02', uploaded_at: null, status: 'archive' },
      { id: 'old', first_saved_at: '2026-10-01', uploaded_at: null, status: 'approved' },
    ],
    agencies: [{ key: 'agency-key', name: 'SAMPLE MEDIA', unchecked: true }],
    facts: [
      { id: 'a', kind: 'Gross amount', status: 'checked', value: '$100', version_id: 'old' },
      { id: 'b', kind: 'Gross amount', status: 'checked', value: '$50', version_id: 'old' },
      { id: 'c', kind: 'Advertiser', status: 'checked', value: 'SAMPLE CMTE', version_id: 'old' },
    ],
    dates: [],
    connections: [],
  };
  it('lists values of one kind under 1 label, links the agency name, and names a newer original', async () => {
    request.mockResolvedValue(file);
    await act(async () =>
      root.render(
        session(<TVFile fileKey="file" params={{}} onParams={vi.fn()} notFound={vi.fn()} />),
      ),
    );
    const labels = Array.from(mount.querySelectorAll('.tv-fact-label')).map((n) => n.textContent);
    expect(labels.filter((label) => label === 'Gross amount')).toHaveLength(1);
    expect(mount.textContent).toContain(
      'A newer saved version has no approved copy yet: its original opens from the versions menu',
    );
    const agency = links().find((link) =>
      link.textContent?.includes('Agency name “SAMPLE MEDIA”'),
    )!;
    expect(new URL(agency.href).pathname).toBe('/money/ads/agencies/agency-key');
    const roles = links()
      .filter((link) => link.pathname === '/money/payments')
      .map((link) => new URL(link.href).searchParams.get('role'));
    expect(roles).toEqual(['vendor', 'independent_vendor']);
    for (const retired of [
      'awaiting approval',
      'Not shown yet',
      'its approval was withdrawn',
      'Record unavailable',
      'An approved copy is not ready',
    ])
      expect(mount.textContent).not.toContain(retired);
  });
});

describe('connection cards', () => {
  it('names the committee seat and each row’s checked election on the legislator tab', async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ads/access'
          ? { allowed: true }
          : {
              committee: { name: 'Sample Lakes Committee', office: 'House', district: '99A' },
              files: [],
              groups: [
                {
                  label: '',
                  files: [
                    {
                      key: 'f',
                      name: 'Order 4471',
                      station: 'KSTP-TV',
                      year: 2026,
                      category: 'State',
                      uploaded_at: null,
                      role: 'Advertiser, as printed',
                      election: '2026 general election',
                    },
                  ],
                },
              ],
            },
      ),
    );
    await act(async () =>
      root.render(
        <TVAdConnectionCard
          kind="committee"
          target="19002"
          scopeLabel="Sample Lakes Committee"
          legislatorTab
        />,
      ),
    );
    expect(mount.textContent).toContain(
      'Sample Lakes Committee · registered for House District 99A',
    );
    expect(mount.textContent).toContain('Advertiser, as printed · 2026 general election');
  });
  it('heads the candidate card’s 2 groups apart', async () => {
    const row = {
      key: 'f',
      name: 'Order',
      station: 'KSTP-TV',
      year: 2026,
      category: 'State',
      uploaded_at: null,
    };
    request.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ads/access'
          ? { allowed: true }
          : {
              files: [row],
              groups: [
                {
                  label: 'Files with a checked connection to Sample Lakes Committee',
                  files: [{ ...row, role: 'Advertiser, as printed' }],
                },
                {
                  label: 'Station files that name this candidate',
                  files: [{ ...row, role: 'Named on page 1' }],
                },
              ],
            },
      ),
    );
    await act(async () => root.render(<TVAdConnectionCard kind="candidate" target="c" name="A" />));
    expect(Array.from(mount.querySelectorAll('h3')).map((h) => h.textContent)).toEqual([
      'Files with a checked connection to Sample Lakes Committee',
      'Station files that name this candidate',
    ]);
    expect(mount.textContent).not.toMatch(/\bnamed\b|\badvertiser\b/);
  });
});

describe('folder, agency and station pages', () => {
  it('links a folder to its station page', async () => {
    request.mockResolvedValue({
      key: 'kstp-tv-1',
      station: 'KSTP-TV',
      label: 'Sample folder',
      year: 2026,
      category: 'State',
      files: [],
      fcc_url: 'https://publicfiles.fcc.gov/',
    });
    await act(async () =>
      root.render(session(<TVFolder recordKey="kstp-tv-1" notFound={vi.fn()} />)),
    );
    expect(links().some((link) => link.pathname === '/money/ads/stations/KSTP-TV')).toBe(true);
  });
  it('lists every file under one printed address, with each file’s role where they differ', async () => {
    request.mockResolvedValue({
      key: 'agency',
      name: 'SAMPLE MEDIA',
      payments_href: '/money/payments?name=SAMPLE%20MEDIA&role=vendor',
      independent_payments_href: '/money/payments?name=SAMPLE%20MEDIA&role=independent_vendor',
      groups: [],
      addresses: [
        {
          address: '456 SAMPLE AVE',
          role: null,
          evidence: [
            {
              file_key: 'a',
              file_name: 'Order A',
              version_id: 'v',
              page: 1,
              uploaded_at: null,
              checked_at: '2026-10-01',
              role: 'Agency address',
            },
            {
              file_key: 'b',
              file_name: 'Invoice B',
              version_id: 'v',
              page: 2,
              uploaded_at: null,
              checked_at: '2026-10-02',
              role: 'Remit to',
            },
          ],
        },
      ],
    });
    await act(async () => root.render(session(<TVAgency recordKey="agency" notFound={vi.fn()} />)));
    expect(mount.querySelectorAll('.tv-address')).toHaveLength(1);
    expect(mount.textContent).toContain('Role as printed: Agency address');
    expect(mount.textContent).toContain('Role as printed: Remit to');
    expect(mount.textContent).toContain('Outside spending payments with this exact printed name');
  });
  it('says a category with no held folder is none held, never unavailable', async () => {
    request.mockResolvedValue({
      call_sign: 'KSTP-TV',
      facility_id: '28010',
      fcc_url: 'https://publicfiles.fcc.gov/',
      last_file_copy: '2026-10-10',
      counts: {
        station_files_held: 1,
        unique_file_contents: 1,
        files_with_approved_copy: 0,
        text_read_failures: 0,
        download_failures: 0,
        checked_connection_files: 0,
      },
      folder_count: 2,
      folder_failures: 0,
      years: [
        { year: 2026, categories: [{ name: 'State', count: 1 }], file_count: 1 },
        { year: 2024, categories: [{ name: 'Federal', count: 1 }], file_count: 1 },
      ],
    });
    await act(async () =>
      root.render(session(<TVStation recordKey="kstp-tv" notFound={vi.fn()} />)),
    );
    expect(mount.textContent).toContain('None held');
    expect(mount.textContent).not.toContain('Unavailable');
    expect(mount.textContent).toContain(
      'No Local, Non-candidate issue ads or Terms folders are held',
    );
    expect(mount.textContent).not.toContain('for this station');
  });
});
