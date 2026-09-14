import type { ApiNameSearchRowPayload } from './api';
import type { NameSearchRow } from './types';

/** One served result row, read by its own `kind` rather than by the group it
 *  arrived in — which is what would break the day a group holds 2 shapes. */
export function nameSearchRow(row: ApiNameSearchRowPayload): NameSearchRow | null {
  if (row.kind === 'lobbyist' && row.registration_number)
    return {
      kind: 'lobbyist',
      name: row.name ?? '',
      registrationNumber: row.registration_number,
      principalCount: row.principal_count ?? null,
    };
  if (row.kind === 'principal' && row.entity_id != null)
    return {
      kind: 'principal',
      name: row.name ?? '',
      entityId: row.entity_id,
      latestReportedYear: row.latest_reported_year ?? null,
      sourceLatestYear: row.source_latest_year ?? null,
      linkable: row.linkable === true,
      state: row.state ?? 'unavailable',
    };
  if (row.kind === 'person') {
    return {
      kind: 'person',
      legislatorId: row.id ?? '',
      slug: row.slug ?? '',
      fullName: row.full_name ?? '',
      chamber: row.chamber ?? null,
      districtCode: row.district_code ?? null,
      party: row.party ?? null,
    };
  }
  if (row.kind === 'committee') {
    return {
      kind: 'committee',
      registrationNumber: row.registration_number ?? '',
      name: row.name ?? '',
      filerKind: row.filer_kind ?? null,
      subType: row.sub_type ?? null,
      office: row.office ?? null,
      district: row.district ?? null,
      isClosed: row.is_closed === true,
      terminationDate: row.termination_date ?? null,
    };
  }
  if (row.kind === 'payment_name') {
    return {
      kind: 'payment_name',
      name: row.name ?? '',
      role: row.role ?? '',
      paymentCount: typeof row.payment_count === 'number' ? row.payment_count : null,
    };
  }
  // A shape we do not know how to draw is dropped rather than guessed at, so a
  // new group added on the server cannot render as a blank row.
  return null;
}
