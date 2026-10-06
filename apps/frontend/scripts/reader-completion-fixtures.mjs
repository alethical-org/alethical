import { readFile } from 'node:fs/promises';

// Existing public API snapshots, kept as evidence by the frontend contract tests.
// Fixtures prove client behavior only, never production data or source availability.
export async function readerFixtures() {
  const root = new URL('../src/lib/__tests__/fixtures/', import.meta.url);
  const bill = JSON.parse(await readFile(new URL('bill-page-snapshot.json', root), 'utf8'));
  const legislator = JSON.parse(
    await readFile(new URL('legislator-page-snapshot.json', root), 'utf8'),
  );
  const billRow = { ...bill, file_type: 'HF', file_number: 719 };
  const page = (data) => ({
    data,
    page: { total: data.length, limit: 250, offset: 0, has_more: false },
  });
  const endpoints = new Map([
    ['/api/v1/meta', { data: { data_as_of: '2026-07-14T19:38:30Z' } }],
    ['/api/v1/sessions', page([bill.session])],
    ['/api/v1/policy-areas', page([])],
    ['/api/v1/bills', page([billRow])],
    ['/api/v1/bills/featured', { data: [billRow] }],
    [`/api/v1/bills/${bill.id}`, { data: billRow }],
    [`/api/v1/bills/${bill.id}/votes`, page([])],
    ['/api/v1/legislators', page([legislator])],
    [`/api/v1/legislators/${legislator.slug}`, { data: legislator }],
    [`/api/v1/legislators/${legislator.id}`, { data: legislator }],
    [`/api/v1/legislators/${legislator.id}/bills`, page([billRow])],
    [`/api/v1/legislators/${legislator.slug}/bills`, page([billRow])],
  ]);
  return (pathname) => endpoints.get(pathname);
}
