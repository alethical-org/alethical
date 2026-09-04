import { describe, expect, it, vi } from 'vitest';

import { requestReleaseReload } from '../releaseReload';

function tab(stored: Record<string, string> = {}) {
  const reload = vi.fn();
  return {
    reload,
    target: {
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => {
          stored[key] = value;
        },
      } as unknown as Storage,
    },
  };
}

describe('requestReleaseReload', () => {
  it('reloads once when a file this release needs is missing', () => {
    const first = tab();
    expect(requestReleaseReload(first.target)).toBe(true);
    expect(first.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads a second time in the same tab', () => {
    const stored: Record<string, string> = {};
    expect(requestReleaseReload(tab(stored).target)).toBe(true);
    const again = tab(stored);
    expect(requestReleaseReload(again.target)).toBe(false);
    expect(again.reload).not.toHaveBeenCalled();
  });

  it('shares its one reload with the program that recovers the first file', () => {
    // apps/frontend/public/index.html writes the same key.
    const stored = { 'alethical.release-program-reload': '1' };
    expect(requestReleaseReload(tab(stored).target)).toBe(false);
  });

  it('does nothing where storage is blocked, rather than reloading forever', () => {
    const reload = vi.fn();
    const blocked = {
      location: { reload },
      sessionStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      } as unknown as Storage,
    };
    expect(requestReleaseReload(blocked)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing away from a browser', () => {
    expect(requestReleaseReload(undefined)).toBe(false);
  });
});
