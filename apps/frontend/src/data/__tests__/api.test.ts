import { describe, expect, it } from 'vitest';

import { normalizeBillIdForApi, normalizeBillSubjectId } from '../api';

// #224: the client must never fabricate a session-year. The 94th biennium
// stamps bills both 94-2025- and 94-2026-, so a hand-built "94-2025-<number>"
// pointed at the wrong bill. Canonical keys pass through (chamber upper-cased,
// but the session segment — e.g. "2025s1" — preserved so special-session keys
// still match); a bare label or legacy id becomes a chamber-prefixed number
// alias that the backend resolves within the current session.

describe('normalizeBillIdForApi', () => {
  it('passes a canonical key through, upper-casing only the chamber', () => {
    expect(normalizeBillIdForApi('94-2026-HF4138')).toBe('94-2026-HF4138');
    expect(normalizeBillIdForApi('94-2026-hf4138')).toBe('94-2026-HF4138');
  });

  it('preserves a special-session key (does not upper-case the "s1")', () => {
    expect(normalizeBillIdForApi('94-2025s1-HF5')).toBe('94-2025s1-HF5');
  });

  it('turns a legacy local id into a chamber-prefixed alias with no year', () => {
    const result = normalizeBillIdForApi('bill-sf1832');
    expect(result).toBe('SF1832');
    expect(result).not.toContain('94-2025');
  });

  it('leaves an unrecognized id untouched', () => {
    expect(normalizeBillIdForApi('something-else')).toBe('something-else');
  });
});

describe('normalizeBillSubjectId', () => {
  it('passes a canonical subject id through, special sessions included', () => {
    expect(normalizeBillSubjectId('94-2026-HF4138', 'HF 4138')).toBe('94-2026-HF4138');
    expect(normalizeBillSubjectId('94-2025s1-HF5', 'HF 5')).toBe('94-2025s1-HF5');
  });

  it('turns a bare label into a chamber-prefixed alias with no year', () => {
    expect(normalizeBillSubjectId(undefined, 'SF 1832')).toBe('SF1832');
    expect(normalizeBillSubjectId('bill-sf1832', 'SF 1832')).toBe('SF1832');
    expect(normalizeBillSubjectId(undefined, 'SF 1832')).not.toContain('94-2025');
  });

  it('returns undefined when there is no resolvable bill', () => {
    expect(normalizeBillSubjectId(undefined, undefined)).toBeUndefined();
  });
});
