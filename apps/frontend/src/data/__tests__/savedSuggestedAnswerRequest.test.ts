import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiOrigin = 'https://api.example.test';
const billId = '94-2025-SF334';

describe('saved suggested answer requests', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_API_URL', apiOrigin);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses one GET with only public identity and maps the self-contained facts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            intent: 'bill_text',
            source: 'predefined',
            confidence: 1,
            answer: {
              answer: 'Saved answer.',
              question: 'SF 334: What changes?',
              bill_last_pulled_at: '2026-08-06T12:00:00Z',
              citations: [
                {
                  label: 'SF 334, Sec. 1',
                  bill_id: billId,
                  excerpt: 'Bill text.',
                  url: 'https://revisor.mn.gov/example',
                  section_id: 'laws.0.1.0',
                  section_order: 0,
                  section_available: true,
                },
              ],
              bill: {
                id: billId,
                file_type: 'SF',
                file_number: 334,
                title: 'A bill for an act',
                current_status: 'Introduced',
                chief_sponsors: [],
                stats: {
                  sponsor_count: 0,
                  action_count: 2,
                  version_count: 1,
                  vote_event_count: 3,
                },
                ai_analysis: {
                  question_prompts: ['What changes?'],
                  key_points: [],
                  policy_areas: [],
                },
                actions: [],
              },
              session: { slug: '94-2025', name: '94th Legislature' },
              data_as_of: '2026-08-06T12:00:00Z',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getSavedSuggestedAnswerFromApi } = await import('../api');
    const answer = await getSavedSuggestedAnswerFromApi(billId, 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/ask/suggestions/${billId}/0`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('?q=');
    expect(answer?.question).toBe('SF 334: What changes?');
    expect(answer?.answeringBillCard?.lastPulledAt).toBe('2026-08-06T12:00:00Z');
    expect(answer?.answeringBillCard?.rollCallCount).toBe(3);
    expect(answer?.answeringBillCard?.questionPrompts).toEqual(['What changes?']);
    expect(answer?.citations?.[0].sectionAvailable).toBe(true);
  });

  it('returns a clean miss without posting or retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('missing', { status: 404 }));

    const { getSavedSuggestedAnswerFromApi } = await import('../api');
    await expect(getSavedSuggestedAnswerFromApi(billId, 3)).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));
  });
});
