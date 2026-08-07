import { describe, expect, it } from 'vitest';

import { pendingSignInRequest, trackSignInRequest } from '../trackIntent';

describe('the Track sign-in request', () => {
  it('returns to the exact page and carries the bill and scroll position', () => {
    expect(
      trackSignInRequest('94-2025-HF719', {
        pathname: '/ask',
        search: '?q=housing+bills&sort=action',
        hash: '#sources',
        scrollY: 742,
      }),
    ).toEqual({
      intent: 'track',
      billId: '94-2025-HF719',
      returnTo: '/ask?q=housing+bills&sort=action#sources',
      scrollY: 742,
    });
  });

  it('keeps a plain page plain', () => {
    expect(
      trackSignInRequest('94-2025-SF1832', {
        pathname: '/',
        search: '',
        hash: '',
        scrollY: 0,
      }),
    ).toEqual({
      intent: 'track',
      billId: '94-2025-SF1832',
      returnTo: '/',
      scrollY: 0,
    });
  });
});

describe('the Track request after Google returns', () => {
  it('accepts the saved bill, page, and scroll position', () => {
    expect(
      pendingSignInRequest(
        JSON.stringify({
          intent: 'track',
          billId: '94-2025-HF719',
          returnTo: '/bills?q=housing&page=3',
          scrollY: 1234,
        }),
      ),
    ).toEqual({
      intent: 'track',
      billId: '94-2025-HF719',
      returnTo: '/bills?q=housing&page=3',
      scrollY: 1234,
    });
  });

  it('rejects a Track request with no bill to finish', () => {
    expect(pendingSignInRequest('{"intent":"track","returnTo":"/ask?q=housing"}')).toBeNull();
  });

  it('rejects a return target outside this site', () => {
    expect(
      pendingSignInRequest(
        '{"intent":"track","billId":"94-2025-HF719","returnTo":"https://example.com"}',
      ),
    ).toBeNull();
    expect(
      pendingSignInRequest(
        '{"intent":"track","billId":"94-2025-HF719","returnTo":"//example.com"}',
      ),
    ).toBeNull();
  });

  it('rejects broken saved state instead of breaking the page', () => {
    expect(pendingSignInRequest('not json')).toBeNull();
  });
});
