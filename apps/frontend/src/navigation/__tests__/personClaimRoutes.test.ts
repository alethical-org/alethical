import { describe, expect, it } from 'vitest';
import { pathForRoute, stateFromPathname, targetFromPathname } from '../webRoutes';

const personId = '85c4572a-eb0e-405e-8e30-372cdbcca752';
const candidateId = 'a'.repeat(64);
const claimId = '00000000-0000-4000-8000-000000000001';

describe('profile journeys keep exact public identities without private input', () => {
  it('round trips a person return to the exact election record', () => {
    const params = { personId, fromCandidateId: candidateId };
    const href = pathForRoute({ name: 'PersonOverview', params });
    expect(href).toBe(`/people/${personId}?candidate=${candidateId}`);
    expect(targetFromPathname(`${href}&address=private&legislator=other-person`)).toEqual({
      kind: 'personOverview',
      ...params,
    });
    expect(stateFromPathname(href).routes[1]).toEqual({ name: 'PersonOverview', params });
  });
  it('keeps a valid legislator return and refuses outside or malformed destinations', () => {
    expect(targetFromPathname(`/people/${personId}?legislator=test-person`)).toEqual({
      kind: 'personOverview',
      personId,
      fromLegislatorSlug: 'test-person',
    });
    expect(
      targetFromPathname(`/people/${personId}?candidate=bad&legislator=https://evil.test`),
    ).toEqual({ kind: 'personOverview', personId });
    expect(targetFromPathname('/people/not-a-person').kind).toBe('notFound');
    expect(targetFromPathname(`/people/${personId}/research`).kind).toBe('notFound');
  });
  it('opens the exact admin request after sign-in without preserving notes or email', () => {
    const params = { candidateId, claimId, fromProfile: true };
    const href = pathForRoute({
      name: 'AdminCandidateClaims',
      params: { ...params, email: 'private@example.org', note: 'private' },
    });
    expect(href).toBe(
      `/admin/candidate-claims?candidate=${candidateId}&claim=${claimId}&from=profile`,
    );
    expect(targetFromPathname(`${href}&email=private@example.org`)).toEqual({
      kind: 'adminCandidateClaims',
      ...params,
    });
    expect(stateFromPathname(href).routes[1]).toEqual({ name: 'AdminCandidateClaims', params });
  });
  it('does not make a return link from an invalid candidate identity', () => {
    expect(
      targetFromPathname(`/admin/candidate-claims?candidate=bad&claim=bad&from=profile`),
    ).toEqual({ kind: 'adminCandidateClaims' });
    expect(stateFromPathname('/admin/candidate-claims').routes[1]).toEqual({
      name: 'AdminCandidateClaims',
    });
  });
});
