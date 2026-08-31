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

// The 7-day hold in pnpm-workspace.yaml (minimumReleaseAge) is a deliberate
// supply-chain protection: nothing installs until it has been public a week. Expo
// publishes its expected versions immediately, so the two rules collide every time
// Expo moves to a patch younger than that. The hold wins, and this check has to
// know it, or CI red-lights every branch for days over a version we are refusing to
// install on purpose (react-native 0.86.3, 2 days old, blocked every branch on
// 27 Aug 2026).
//
// So: run Expo's check, and treat it as passing when EVERY complaint is a package
// whose expected version is still inside the hold. Anything else still fails.
const HOLD_DAYS = 7;
const EXPECTATION = /^\s*(\S+)@(\S+)\s+-\s+expected version:\s+(\S+)\s*$/;

async function publishedDaysAgo(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!response.ok) return null;
  const published = (await response.json())?.time?.[version];
  if (!published) return null;
  return (Date.now() - new Date(published).getTime()) / 86_400_000;
}

const output = [];
const child = spawn(process.execPath, [expoCli, 'install', '--check'], {
  cwd: resolve(repoRoot, 'apps', 'frontend'),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

child.on('exit', async (code, signal) => {
  const text = output.join('');
  process.stdout.write(text);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (!code) {
    process.exit(0);
  }

  const complaints = text
    .split('\n')
    .map((line) => line.match(EXPECTATION))
    .filter(Boolean)
    .map(([, name, , expected]) => ({ name, expected }));

  if (complaints.length === 0) {
    process.exit(code);
  }

  const held = [];
  for (const { name, expected } of complaints) {
    const age = await publishedDaysAgo(name, expected);
    if (age === null || age >= HOLD_DAYS) {
      console.error(
        `${name}@${expected} is ${age === null ? 'of unknown age' : `${age.toFixed(1)} days old`}, ` +
          `past the ${HOLD_DAYS}-day hold, so this is a real mismatch to fix.`,
      );
      process.exit(code);
    }
    held.push(`${name}@${expected} (${age.toFixed(1)} days old)`);
  }

  console.log(
    `Every mismatch is inside the ${HOLD_DAYS}-day install hold, so the hold wins: ` +
      `${held.join(', ')}. Bump once each has matured.`,
  );
  process.exit(0);
});
