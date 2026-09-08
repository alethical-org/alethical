import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Write into the served page which commit built it.
 *
 * WHY A PAGE HAS TO CARRY THIS. On 8 Sep 2026 commit `04005cfd` merged to `main`,
 * changed `api/page.ts` and `apps/frontend`, and received no production build at
 * all: readers kept the previous page for 29 minutes, every check was green, and
 * nothing failed anywhere. The merge queue had merged it together with a
 * docs-only commit, so `main` advanced by 2 commits in 1 push, Vercel built only
 * the push's head, and `vercel.json`'s ignore step compared that head against its
 * immediate parent and correctly found docs. Nothing in between was ever built.
 * `.github/workflows/production-release-failed.yml` watches for a release that
 * FAILS and cannot see one that never started
 * ([issue 2075](https://github.com/alethical-org/alethical/issues/2075)).
 *
 * WHY THE PROGRAM FILENAMES COULD NOT ANSWER IT INSTEAD. The obvious check is to
 * build `main` and compare the content-hashed `index-*.js` name against the one
 * production serves. Measured on commit `c9c9035b`, 8 Sep 2026: this repository's
 * build produced `index-fa1ab8a5...` where production served `index-c9122423...`
 * for that same commit. A deploying build inlines the 6 public `EXPO_PUBLIC_*`
 * settings and a checkout has none, so that name differs by construction, and a
 * check keyed on it would fire on every single merge. See
 * `apps/frontend/scripts/check-first-load-budget.mjs`'s
 * `HOSTED_BUILD_EXCESS_BYTES` for the same measurement from the size side.
 *
 * So the page says the commit outright. One read of one address then answers
 * "what is live", exactly, with no build and no Vercel credentials, which is what
 * `scripts/check_production_release_reached_readers.py` does after every merge.
 * It is also the fastest way for a person to answer the same question by hand:
 *
 *   curl -sL https://www.alethical.com/ | grep alethical-release-commit
 */

/** The stamp's own name, so the writer and every reader agree on 1 spelling. */
export const RELEASE_COMMIT_META_NAME = 'alethical-release-commit';

/**
 * Where the stamp goes, and it matters which side of the head markers it is on.
 *
 * `api/page.ts` replaces everything between `<!--alethical:page-head-->` and its
 * closing marker for every address it serves, so a stamp inside them survives on
 * `/` (served straight off the filesystem) and vanishes on every other page.
 * Anchoring to the charset line puts it above those markers, where the per-address
 * head rewrite cannot reach it.
 */
const ANCHOR = '<meta charset="utf-8" />';

const STAMP_PATTERN = new RegExp(
  `[ \\t]*<meta name="${RELEASE_COMMIT_META_NAME}" content="[^"]*"\\s*/>\\n?`,
  'g',
);

/**
 * The commit this build is of, or null when the build cannot know.
 *
 * `VERCEL_GIT_COMMIT_SHA` is what a Git-connected Vercel build sets and is the
 * normal answer. `ALETHICAL_COMMIT_SHA` is passed by
 * `.github/workflows/vercel-deploy.yml`, the hand-run production deploy that
 * repairs a missed release, because that path uploads a source archive rather
 * than being driven by a Git connection. `GITHUB_SHA` covers a build inside a
 * GitHub job.
 *
 * A plain local build matches none of them and gets no stamp. That is fine and
 * must not fail: what a laptop builds never reaches a reader. A DEPLOYING build
 * with no stamp is a different matter, and the check reports that as its own
 * alarm rather than going quiet, because an instrument nobody can read is how
 * this incident happened in the first place.
 */
export function releaseCommitSha(env) {
  for (const name of ['ALETHICAL_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA']) {
    const value = (env[name] ?? '').trim();
    if (/^[0-9a-f]{40}$/.test(value)) return value;
  }
  return null;
}

/**
 * The same page with its release stamp, replacing any stamp already there.
 *
 * Throws when the anchor is gone. A silently unstamped page is unwatchable, and a
 * build that fails here fails in the pull request that moved the anchor, which is
 * the only place anybody can fix it.
 */
export function withReleaseStamp(html, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
    throw new Error(`Not a commit: ${JSON.stringify(sha)}`);
  }
  const cleared = html.replace(STAMP_PATTERN, '');
  if (!cleared.includes(ANCHOR)) {
    throw new Error(
      `The built page no longer carries ${JSON.stringify(ANCHOR)}, so the release stamp has ` +
        'nowhere to go. Move the anchor in apps/frontend/scripts/stamp-release-commit.mjs to ' +
        'a line the page still has, above the <!--alethical:page-head--> marker.',
    );
  }
  return cleared.replace(
    ANCHOR,
    `${ANCHOR}\n    <meta name="${RELEASE_COMMIT_META_NAME}" content="${sha}" />`,
  );
}

/** The stamp a page carries, or null when it carries none. */
export function releaseStampIn(html) {
  const found = html.match(
    new RegExp(`<meta name="${RELEASE_COMMIT_META_NAME}" content="([0-9a-f]{40})"`),
  );
  return found ? found[1] : null;
}

async function stampBuiltPage() {
  const sha = releaseCommitSha(process.env);
  const page = new URL('../dist/index.html', import.meta.url);
  if (!sha) {
    console.log(
      'Release stamp skipped: this build knows no commit, so the page carries none. ' +
        'Expected for a local build; a deploying build sets VERCEL_GIT_COMMIT_SHA.',
    );
    return;
  }
  const html = await readFile(page, 'utf8');
  await writeFile(page, withReleaseStamp(html, sha));
  console.log(`Release stamp written: ${sha}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  stampBuiltPage().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
