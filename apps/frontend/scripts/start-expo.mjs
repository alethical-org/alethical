import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..', '..');
const envPath = resolve(repoRoot, '.env');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    // Don't clobber a variable the caller already set. `.env` holds the shared
    // defaults; an explicit `EXPO_PUBLIC_API_URL=… pnpm run web` is the caller
    // asking for something else (e.g. QA against a local API on another port), and
    // overwriting it silently sent the app to the `.env` value instead — which
    // looks like the app ignoring you, since nothing logs the substitution. Same
    // precedence every dotenv loader uses: real environment wins over the file.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const passthroughArgs = process.argv.slice(2);
const command = passthroughArgs[0] === 'export' ? passthroughArgs.shift() : 'start';
const expoCli = resolve(repoRoot, 'node_modules', 'expo', 'bin', 'cli');
const expoArgs = [expoCli, command, ...passthroughArgs];
const child = spawn(process.execPath, expoArgs, {
  cwd: resolve(repoRoot, 'apps', 'frontend'),
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
