import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import candidate from '../../screens/redesign/__tests__/fixtures/committee-money/19193-finance-2025.json';
import { committeeConfirmationFromPayload } from '../../lib/committeeConfirmation';

const confirmation = () => ({
  registration_number: candidate.data.registration_number,
  confirmed_for: candidate.data.confirmed_for,
  current_claim_validated_at: candidate.data.current_claim_validated_at,
});

describe('separate committee figures and confirmation', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  function answer(data: unknown, age = '120') {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data }), {
        headers: { 'Content-Type': 'application/json', Age: age },
      }),
    );
  }

  it('retains the real confirmed identity and its evidence with the short-lived answer', async () => {
    answer(confirmation());
    const { getCommitteeConfirmationFromApi } = await import('../api');
    const claim = await getCommitteeConfirmationFromApi('19193');
    expect(claim.confirmedFor?.fullName).toBe(candidate.data.confirmed_for?.full_name);
    expect(claim.confirmedFor?.checked?.checkedOn).toBe(
      candidate.data.confirmed_for?.checked?.checked_on,
    );
    expect(claim.currentClaim.servedAgeMs).toBe(120_000);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/committees/19193/confirmation');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('year=');
  });

  it('reads only dated figures, dropping legacy confirmation fields during rollout', async () => {
    answer(candidate.data, '86400');
    const { getCommitteeFinanceFromApi } = await import('../api');
    const money = await getCommitteeFinanceFromApi('19193', 2025);
    expect(money?.split.reportedTotal).toBe(candidate.data.split.reported_total);
    expect(money?.register.party).toBe(candidate.data.register.party);
    expect(money).not.toHaveProperty('confirmedFor');
    expect(money).not.toHaveProperty('currentClaim');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/finance?year=2025&include_confirmation=false',
    );
  });

  it('accepts a successful explicit null', () => {
    expect(
      committeeConfirmationFromPayload(
        { registration_number: '20003', confirmed_for: null },
        { servedAgeMs: 0 },
      ).confirmedFor,
    ).toBeNull();
  });

  it.each([
    { registration_number: '19193' },
    { registration_number: '19193', confirmed_for: {} },
    { registration_number: '19193', confirmed_for: { full_name: 'David Gottfried' } },
  ])('rejects a missing or incomplete confirmation instead of naming nobody: %j', (data) => {
    expect(() => committeeConfirmationFromPayload(data, { servedAgeMs: 0 })).toThrow('incomplete');
  });

  it('rejects the wrong registration and a failed read', async () => {
    const { getCommitteeConfirmationFromApi } = await import('../api');
    answer({ ...confirmation(), registration_number: '17868' });
    await expect(getCommitteeConfirmationFromApi('19193')).rejects.toThrow('does not match');
    fetchMock.mockResolvedValue(new Response('Temporary failure', { status: 503 }));
    await expect(getCommitteeConfirmationFromApi('19193')).rejects.toMatchObject({ status: 503 });
  });
});
