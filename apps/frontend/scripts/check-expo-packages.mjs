import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..', '..');
const expoCli = resolve(repoRoot, 'node_modules', 'expo', 'bin', 'cli');
const packagePath = resolve(repoRoot, 'apps', 'frontend', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

// Expo's online list can move to package patches that Alethical's 7-day hold
// blocks. Keep the reviewed set exact, then validate everything else normally.
const heldPackages = {
  expo: '57.0.11',
  '@expo/metro-runtime': '57.0.8',
  'expo-auth-session': '57.0.6',
  'expo-splash-screen': '57.0.5',
};

for (const [name, expected] of Object.entries(heldPackages)) {
  const actual = packageJson.dependencies[name];
  if (actual !== expected) {
    console.error(
      `${name} must stay at ${expected} until its replacement passes the 7-day hold; found ${actual}.`,
    );
    process.exit(1);
  }
}

const child = spawn(process.execPath, [expoCli, 'install', '--check'], {
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
