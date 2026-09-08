// Use the project's installed, exact formatter and settings, never a global one.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(root, 'apps/frontend');
try {
  const wanted = JSON.parse(readFileSync(resolve(frontend, 'package.json'))).devDependencies
    .prettier;
  const prettier = [
    resolve(frontend, 'node_modules/prettier'),
    resolve(root, 'node_modules/prettier'),
  ].find((path) => existsSync(resolve(path, 'package.json')));
  if (!prettier) throw new Error('The project formatter is not installed.');
  const installed = JSON.parse(readFileSync(resolve(prettier, 'package.json'))).version;
  if (installed !== wanted) throw new Error('Installed Prettier does not match the saved version.');
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  if (check) args.shift();
  const files = args.length ? args.map((file) => resolve(file)) : ['.'];
  const result = spawnSync(
    process.execPath,
    [
      resolve(prettier, 'bin/prettier.cjs'),
      '--config',
      resolve(frontend, '.prettierrc.json'),
      '--ignore-path',
      resolve(frontend, '.prettierignore'),
      '--ignore-unknown',
      check ? '--check' : '--write',
      '--',
      ...files,
    ],
    { cwd: frontend, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    `Frontend formatting stopped: ${error.message} Run pnpm install --frozen-lockfile first.`,
  );
  process.exitCode = 1;
}
