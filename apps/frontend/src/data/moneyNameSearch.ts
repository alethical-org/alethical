import type { ApiNameSearchPayload, ApiNameSearchRowPayload } from './api';
import type { NameSearchGroup, NameSearchRow } from './types';

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

/**
 * A group's own state, keeping all 3 the server serves.
 *
 * `not_reported` must survive the trip: it means we searched this part of the
 * records and nothing carried that spelling, where `unavailable` means we could
 * not read it. Mapping the first onto the second prints "a gap on our side" over
 * a verified nothing, which is the missing-versus-zero failure
 * `.claude/rules/grounded-answers.md` rule 12 forbids — and it did exactly that
 * on the first build of this page, on every zero-match group.
 */
function nameSearchGroupState(state: string | undefined): NameSearchGroup['state'] {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

export function nameSearchGroups(groups: ApiNameSearchPayload['groups']): NameSearchGroup[] {
  return (groups ?? []).map((group) => ({
    kind: group.kind ?? '',
    state: nameSearchGroupState(group.state),
    results:
      group.state === 'reported'
        ? (group.results ?? [])
            .map(nameSearchRow)
            .filter((row): row is NameSearchRow => row !== null)
        : [],
    total: typeof group.total === 'number' ? group.total : null,
    atLeast: typeof group.at_least === 'number' ? group.at_least : null,
    hasMore: group.has_more === true,
    reason: group.reason ?? null,
  }));
}
