import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidatePreviewEnabled } from '../../lib/candidateLookupAvailability';
import { pathForRoute, stateFromPathname, targetFromPathname } from '../webRoutes';

describe('public candidate destination and development record review', () => {
  beforeEach(() => {
    vi.stubGlobal('__DEV__', true);
    vi.stubEnv('EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW', 'true');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('keeps the public destination in production without activating example profiles', () => {
    vi.stubGlobal('__DEV__', false);
    expect(candidatePreviewEnabled()).toBe(false);
    expect(targetFromPathname('/candidates')).toEqual({ kind: 'candidates' });
    expect(stateFromPathname('/candidates').routes.at(-1)).toEqual({ name: 'Candidates' });
    expect(pathForRoute({ name: 'Candidates' })).toBe('/candidates');
    expect(targetFromPathname('/candidates/preview-general-alex').kind).toBe('notFound');
  });
  it('opens the public destination without development opt-in but keeps example profiles off', () => {
    vi.stubEnv('EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW', '');
    expect(targetFromPathname('/candidates')).toEqual({ kind: 'candidates' });
    expect(targetFromPathname('/candidates/preview-general-alex').kind).toBe('notFound');
  });
  it('ignores private address and election URL inputs', () => {
    vi.stubGlobal('__DEV__', false);
    const target = targetFromPathname('/candidates?address=private-home&election=older');
    expect(target).toEqual({ kind: 'candidates' });
    expect(stateFromPathname('/candidates?address=private-home').routes.at(-1)).toEqual({
      name: 'Candidates',
    });
    expect(pathForRoute({ name: 'Candidates', params: { address: 'private-home' } })).toBe(
      '/candidates',
    );
  });
  it('permits illustrative record IDs only in development but not nested claim routes', () => {
    expect(targetFromPathname('/candidates/preview-general-alex')).toEqual({
      kind: 'candidateProfile',
      candidateId: 'preview-general-alex',
    });
    expect(
      pathForRoute({
        name: 'CandidateProfile',
        params: { candidateId: 'preview-general-alex', address: 'private-home' },
      }),
    ).toBe('/candidates/preview-general-alex');
    expect(targetFromPathname('/candidates/preview-general-alex/claim').kind).toBe('notFound');
    expect(targetFromPathname('/candidates/%3Cscript%3E').kind).toBe('notFound');
  });
});

it('opens public source record IDs in production with no private URL inputs', () => {
  vi.stubGlobal('__DEV__', false);
  const id = 'a'.repeat(64);
  try {
    expect(targetFromPathname(`/candidates/${id}?address=private-home&election=old`)).toEqual({
      kind: 'candidateProfile',
      candidateId: id,
    });
    expect(stateFromPathname(`/candidates/${id}`).routes.at(-1)).toEqual({
      name: 'CandidateProfile',
      params: { candidateId: id },
    });
    expect(
      pathForRoute({
        name: 'CandidateProfile',
        params: { candidateId: id, address: 'private-home' },
      }),
    ).toBe(`/candidates/${id}`);
    expect(targetFromPathname(`/candidates/${id}/claim`)).toEqual({
      kind: 'candidateClaim',
      candidateId: id,
    });
    expect(targetFromPathname(`/candidates/${'a'.repeat(63)}`).kind).toBe('notFound');
    expect(
      pathForRoute({ name: 'CandidateProfile', params: { candidateId: 'preview-general-alex' } }),
    ).toBe('/404');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('opens the production claim, manage and administrator routes without private route fields', () => {
  vi.stubGlobal('__DEV__', false);
  try {
    const id = 'a'.repeat(64);
    for (const [name, kind, path] of [
      ['CandidateClaim', 'candidateClaim', `/candidates/${id}/claim`],
      ['CandidateManage', 'candidateManage', `/candidates/${id}/manage`],
    ] as const) {
      expect(targetFromPathname(`${path}?address=private`)).toEqual({ kind, candidateId: id });
      expect(pathForRoute({ name, params: { candidateId: id, evidence_url: 'private' } })).toBe(
        path,
      );
      expect(stateFromPathname(path).routes.at(-1)).toEqual({ name, params: { candidateId: id } });
    }
    expect(targetFromPathname('/admin/candidate-claims')).toEqual({ kind: 'adminCandidateClaims' });
    expect(stateFromPathname('/admin/candidate-claims').routes.at(-1)).toEqual({
      name: 'AdminCandidateClaims',
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
