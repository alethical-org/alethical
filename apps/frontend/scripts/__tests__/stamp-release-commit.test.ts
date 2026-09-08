import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_COMMIT_META_NAME,
  releaseCommitSha,
  releaseStampIn,
  withReleaseStamp,
} from '../stamp-release-commit.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('releaseCommitSha', () => {
  it('reads what a Git-connected Vercel build sets', () => {
    expect(releaseCommitSha({ VERCEL_GIT_COMMIT_SHA: SHA })).toBe(SHA);
  });

  it('prefers what the hand-run production deploy passes', () => {
    expect(releaseCommitSha({ ALETHICAL_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_SHA: OTHER })).toBe(SHA);
  });

  it('falls back to the commit a GitHub job is on', () => {
    expect(releaseCommitSha({ GITHUB_SHA: SHA })).toBe(SHA);
  });

  it('knows no commit in a plain local build', () => {
    expect(releaseCommitSha({})).toBeNull();
  });

  it('refuses a value that is not a commit, rather than stamping a branch name', () => {
    expect(releaseCommitSha({ VERCEL_GIT_COMMIT_SHA: 'main' })).toBeNull();
    expect(releaseCommitSha({ VERCEL_GIT_COMMIT_SHA: SHA.slice(0, 7) })).toBeNull();
  });
});

describe('withReleaseStamp', () => {
  const page = '<html>\n  <head>\n    <meta charset="utf-8" />\n    <title>x</title>';

  it('puts the commit where every address keeps it', () => {
    expect(releaseStampIn(withReleaseStamp(page, SHA))).toBe(SHA);
  });

  it('replaces an earlier stamp instead of adding a second one', () => {
    const restamped = withReleaseStamp(withReleaseStamp(page, SHA), OTHER);
    expect(restamped.match(new RegExp(RELEASE_COMMIT_META_NAME, 'g'))).toHaveLength(1);
    expect(releaseStampIn(restamped)).toBe(OTHER);
  });

  it('fails loudly when the anchor is gone, rather than shipping an unwatchable page', () => {
    expect(() => withReleaseStamp('<html><head><title>x</title>', SHA)).toThrow(
      /no longer carries/,
    );
  });

  it('refuses to stamp something that is not a commit', () => {
    expect(() => withReleaseStamp(page, 'main')).toThrow(/Not a commit/);
  });
});

describe('the shipped page shell', () => {
  // The anchor is a line of `apps/frontend/public/index.html`. Nothing else pins
  // the two together, so an edit to that line would otherwise only be found by a
  // deploying build, where the failure costs a release.
  it('still carries the line the stamp anchors to', () => {
    const shell = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expect(() => withReleaseStamp(shell, SHA)).not.toThrow();
  });

  it('keeps the stamp above the head that api/page.ts replaces per address', () => {
    const shell = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    const stamped = withReleaseStamp(shell, SHA);
    expect(stamped.indexOf(RELEASE_COMMIT_META_NAME)).toBeLessThan(
      stamped.indexOf('<!--alethical:page-head-->'),
    );
  });
});

describe('releaseStampIn', () => {
  it('finds nothing in a page that carries no stamp', () => {
    expect(releaseStampIn('<html><head></head></html>')).toBeNull();
  });
});
