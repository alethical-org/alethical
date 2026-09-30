import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidatePreviewEnabled } from '../../lib/candidateLookupAvailability';
import { pathForRoute, stateFromPathname, targetFromPathname } from '../webRoutes';

describe('private candidate routes', () => {
  beforeEach(() => {
    vi.stubGlobal('__DEV__', true);
    vi.stubEnv('EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW', 'true');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('never activates a production build, even with the review flag set', () => {
    vi.stubGlobal('__DEV__', false);
    expect(candidatePreviewEnabled()).toBe(false);
    expect(targetFromPathname('/candidates').kind).toBe('notFound');
    expect(targetFromPathname('/candidates/preview-general-alex').kind).toBe('notFound');
  });
  it('needs explicit opt-in in development', () => {
    vi.stubEnv('EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW', '');
    expect(targetFromPathname('/candidates').kind).toBe('notFound');
  });
  it('ignores private address and election URL inputs', () => {
    const target = targetFromPathname('/candidates?address=private-home&election=older');
    expect(target).toEqual({ kind: 'candidates' });
    expect(stateFromPathname('/candidates?address=private-home').routes.at(-1)).toEqual({
      name: 'Candidates',
    });
    expect(pathForRoute({ name: 'Candidates', params: { address: 'private-home' } })).toBe(
      '/candidates',
    );
  });
  it('permits election-scoped public record IDs but not nested private routes', () => {
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
