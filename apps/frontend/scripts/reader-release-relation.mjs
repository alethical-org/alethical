import { spawnSync } from 'node:child_process';
import { commitSha } from './reader-completion-policy.mjs';

export function websitePathsFromConfig(text) {
  const config = JSON.parse(text);
  const prefix = 'bash scripts/vercel-ignore-build.sh -- ';
  if (typeof config.ignoreCommand !== 'string' || !config.ignoreCommand.startsWith(prefix)) {
    throw new Error('Unsupported website path command');
  }
  const words = config.ignoreCommand.slice(prefix.length).split(' ');
  if (
    !words.length ||
    words.some(
      (path) =>
        !/^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(path) ||
        path.split('/').some((part) => ['', '.', '..'].includes(part)),
    )
  ) {
    throw new Error('Unsupported website path list');
  }
  // The release settings themselves must be included in equivalence proof.
  if (!words.includes('vercel.json')) throw new Error('Website config absent from path list');
  return words;
}

/** Read the intended commit's settings, never the checkout's mutable copy.
 * Unknown objects, unsupported commands, and Git errors cannot prove equality. */
export function readerReleaseRelation({ expected, served, allowNewer, allowEquivalent, cwd }) {
  commitSha(expected);
  commitSha(served);
  if (expected === served) return 'exact';
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (root.status !== 0 || !root.stdout?.trim()) return 'unproven-history';
  const repositoryRoot = root.stdout.trim();
  const git = (args) =>
    spawnSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const known = [expected, served].every(
    (sha) => git(['cat-file', '-e', `${sha}^{commit}`]).status === 0,
  );
  if (!known) return 'unproven-history';
  if (allowNewer && git(['merge-base', '--is-ancestor', expected, served]).status === 0)
    return 'newer-descendant';
  if (!allowEquivalent || git(['merge-base', '--is-ancestor', served, expected]).status !== 0)
    return 'mismatch';
  const config = git(['show', `${expected}:vercel.json`]);
  if (config.status !== 0) return 'unproven-website-paths';
  let paths;
  try {
    paths = websitePathsFromConfig(config.stdout);
  } catch {
    return 'unproven-website-paths';
  }
  const diff = git(['diff', '--quiet', served, expected, '--', ...paths]);
  if (diff.status === 0) return 'older-equivalent-website';
  return diff.status === 1 ? 'mismatch' : 'unproven-website-diff';
}
