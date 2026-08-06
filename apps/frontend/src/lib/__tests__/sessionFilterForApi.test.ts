import { describe, expect, it } from 'vitest';

import { sessionFilterForApi } from '../sessionFilterForApi';

describe('sessionFilterForApi', () => {
  it('keeps the API current-session default when the URL has no session', () => {
    expect(sessionFilterForApi(undefined)).toBeUndefined();
    expect(sessionFilterForApi('')).toBeUndefined();
    expect(sessionFilterForApi('   ')).toBeUndefined();
  });

  it('passes an explicit URL session through unchanged', () => {
    expect(sessionFilterForApi('94-2025-regular')).toBe('94-2025-regular');
  });
});
