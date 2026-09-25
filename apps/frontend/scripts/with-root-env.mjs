import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const rootEnvPath = resolve(repoRoot, '.env');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? [key, value] : null;
}

if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-root-env.mjs <command> [...args]');
  process.exit(1);
}

const binPath = resolve(repoRoot, 'node_modules/.bin');
process.env.PATH = `${binPath}${delimiter}${process.env.PATH ?? ''}`;

const nativeEasEntry = resolve(repoRoot, 'tools/native-release/node_modules/eas-cli/bin/run');
if (command === 'eas' && !existsSync(nativeEasEntry)) {
  console.error(
    'Install the optional phone release tools: pnpm --dir tools/native-release install --frozen-lockfile',
  );
  process.exit(1);
}

const localEntry =
  command === 'expo'
    ? resolve(repoRoot, 'node_modules/expo/bin/cli')
    : command === 'eas'
      ? nativeEasEntry
      : null;
const resolvedCommand = localEntry ? process.execPath : command;
const resolvedArgs = localEntry ? [localEntry, ...args] : args;

const child = spawn(resolvedCommand, resolvedArgs, {
  env: process.env,
  shell: !localEntry && process.platform === 'win32',
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
