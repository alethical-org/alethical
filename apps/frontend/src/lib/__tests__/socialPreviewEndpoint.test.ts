import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/social-preview';

function responseRecorder() {
  const headers = new Map<string, string>();
  let body = '';
  let status = 0;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      body = value;
    },
  };
  return { response, read: () => ({ body, headers, status }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('social preview endpoint', () => {
  it('builds a bill card from the public plain-language fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: '94-2025-HF719',
            title: 'A bill for an act relating to public finance',
            ai_analysis: {
              short_title: 'Funds local infrastructure projects across Minnesota',
              summary: 'Funds roads and public buildings across Minnesota. More detail follows.',
            },
          },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { subject: 'bill', id: '94-2025-HF719' } }, recorder.response);

    expect(recorder.read().status).toBe(200);
    expect(recorder.read().body).toContain(
      'property="og:title" content="HF 719: Funds local infrastructure projects across Minnesota"',
    );
    expect(recorder.read().body).toContain(
      'property="og:description" content="Funds roads and public buildings across Minnesota."',
    );
  });

  it('builds a legislator card from the current public service record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            full_name: 'Patti Anderson',
            current_service: {
              chamber: 'house',
              party: 'R',
              district: { code: '33A' },
            },
          },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { subject: 'legislator', id: 'patti-anderson' } }, recorder.response);

    expect(recorder.read().body).toContain(
      'property="og:title" content="Rep. Patti Anderson: Republican, House District 33A"',
    );
  });

  it('keeps only public answer-link fields in the canonical URL', async () => {
    const recorder = responseRecorder();

    await handler(
      {
        query: {
          subject: 'answer',
          q: 'What would HF 719 fund?',
          bill: '94-2025-HF719',
          suggestion: '0',
          authError: 'secret',
        },
      },
      recorder.response,
    );

    expect(recorder.read().body).toContain('What would HF 719 fund?');
    expect(recorder.read().body).toContain('bill=94-2025-HF719');
    expect(recorder.read().body).toContain('suggestion=0');
    expect(recorder.read().body).not.toContain('authError');
    expect(recorder.read().headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });
});
