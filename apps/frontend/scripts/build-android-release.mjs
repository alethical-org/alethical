import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(frontendRoot, '..', '..');
const envPath = resolve(repoRoot, '.env');
const androidRoot = resolve(frontendRoot, 'android');
const gradleScript = resolve(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const syncNetworkScript = resolve(scriptDir, 'sync-android-dev-network-security.mjs');

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
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
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for Android release builds. Set it in ${envPath}.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? frontendRoot,
    env: process.env,
    shell: process.platform === 'win32' && command.endsWith('.bat'),
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

loadEnvFile(envPath);

requireEnv('EXPO_PUBLIC_API_URL');
requireEnv('EXPO_PUBLIC_SUPABASE_URL');
requireEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

if (!existsSync(gradleScript)) {
  throw new Error(
    `Android Gradle wrapper is missing at ${gradleScript}. Run "pnpm --dir apps/frontend exec expo prebuild --platform android" first.`
  );
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH}`;

if (!process.env.JAVA_HOME && process.platform === 'win32') {
  const androidStudioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(androidStudioJbr)) {
    process.env.JAVA_HOME = androidStudioJbr;
  }
}

if (process.platform === 'win32' && process.env.JAVA_HOME) {
  process.env.PATH = `${resolve(process.env.JAVA_HOME, 'bin')}${delimiter}${process.env.PATH}`;
}

const localAndroidSdk = resolve(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
if (!process.env.ANDROID_HOME && existsSync(localAndroidSdk)) {
  process.env.ANDROID_HOME = localAndroidSdk;
}
if (!process.env.ANDROID_SDK_ROOT && process.env.ANDROID_HOME) {
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_HOME;
}

run(process.execPath, [syncNetworkScript]);
run(gradleScript, [':app:createBundleReleaseJsAndAssets', ':app:assembleRelease', '--rerun-tasks', '--no-daemon'], {
  cwd: androidRoot,
});
