import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateProfileRecord } from '../../components/candidates/types';

const id = 'a'.repeat(64);
const record: CandidateProfileRecord = {
  candidate: { id, name: 'Public Candidate', sortName: 'Candidate, Public' },
  office: 'State Representative',
  votingArea: 'House District 1A',
  election: { id: '8334', label: 'General election', date: '2026-11-03', type: 'general' },
  source: {
    authority: 'Minnesota Secretary of State',
    url: 'https://myballotmn.sos.mn.gov/',
    checkedDate: '2026-09-30',
    stale: true,
  },
};
function network(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status })),
  );
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.alethical.com');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('production candidate services', () => {
  it('keeps addresses in private request bodies with no cookies or caching and forwards cancellation', async () => {
    const { candidateSearchServices } = await import('../candidates');
    const controller = new AbortController();
    const request = { address: '100 Example Street, Minneapolis, MN 55415', electionId: '8334' };
    network({ kind: 'no-match' });
    expect(await candidateSearchServices.lookup(request, controller.signal)).toEqual({
      kind: 'no-match',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.alethical.com/api/v1/candidates/lookup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    network([]);
    await candidateSearchServices.suggest(` ${request.address} `, controller.signal);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.alethical.com/api/v1/candidates/suggest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ address: request.address }),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      }),
    );
  });
  it('does not turn failed lookup requests into empty results or illustrative data', async () => {
    const { candidateSearchServices } = await import('../candidates');
    const request = { address: '100 Example Street', electionId: '8334' };
    network({ detail: 'Unavailable' }, 503);
    await expect(
      candidateSearchServices.lookup(request, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    network({ detail: 'Slow down' }, 429);
    expect(await candidateSearchServices.lookup(request, new AbortController().signal)).toEqual({
      kind: 'rate-limited',
    });
    expect(
      await candidateSearchServices.suggest(request.address, new AbortController().signal),
    ).toEqual([]);
  });
  it('gets public election-owned profiles and rejects unknown or mismatched record IDs', async () => {
    const { getCandidateProfile } = await import('../candidates');
    const signal = new AbortController().signal;
    network(record);
    expect(await getCandidateProfile(id, signal)).toEqual(record);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.alethical.com/api/v1/candidates/${id}`,
      expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store' }),
    );
    await expect(getCandidateProfile('preview-general-alex', signal)).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    network({}, 404);
    await expect(getCandidateProfile('b'.repeat(64), signal)).rejects.toMatchObject({
      status: 404,
    });
    network(record);
    await expect(getCandidateProfile('b'.repeat(64), signal)).rejects.toThrow(
      'Invalid candidate record',
    );
  });
  it('hands a new homepage address to the same temporary flow and erases previous results', async () => {
    const { candidateFlow, handoffCandidateAddress } = await import('../candidates');
    network({
      kind: 'results',
      electionId: '8334',
      matchedAddress: '100 Example Street',
      races: [],
      coverage: [],
    });
    handoffCandidateAddress('100 Example Street');
    await candidateFlow.search(
      { address: '100 Example Street', electionId: '8334' },
      record.election,
    );
    expect(candidateFlow.getState().displayed).not.toBeNull();
    handoffCandidateAddress(' 200 Example Street ');
    expect(candidateFlow.getState()).toMatchObject({
      draftAddress: '200 Example Street',
      displayed: null,
      requested: null,
      status: 'idle',
    });
    candidateFlow.clear();
    expect(candidateFlow.getState().draftAddress).toBe('');
  });
});
