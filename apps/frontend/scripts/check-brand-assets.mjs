import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PNG } from 'pngjs';

import { BRAND_ASSETS, MARK_PATH, renderBrandAsset } from './generate-brand-assets.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const errors = [];

for (const asset of BRAND_ASSETS) {
  const assetPath = resolve(projectRoot, asset.path);
  try {
    const actual = PNG.sync.read(await readFile(assetPath));
    const expected = PNG.sync.read(renderBrandAsset(asset));
    if (
      actual.width !== expected.width ||
      actual.height !== expected.height ||
      !actual.data.equals(expected.data)
    ) {
      errors.push(`${asset.path} does not match the current Alethical mark`);
    }
  } catch {
    errors.push(`${asset.path} is missing`);
  }
}

try {
  const preview = PNG.sync.read(await readFile(resolve(projectRoot, 'public/social-preview.png')));
  let lightTextPixels = 0;
  for (let index = 0; index < preview.data.length; index += 4) {
    if (
      preview.data[index] > 180 &&
      preview.data[index + 1] > 180 &&
      preview.data[index + 2] > 180
    ) {
      lightTextPixels += 1;
    }
  }
  if (lightTextPixels < 5_000) {
    errors.push('public/social-preview.png is still a bare-logo picture without useful words');
  }
} catch {
  errors.push('public/social-preview.png cannot be checked for its purpose-made words');
}

try {
  await access(resolve(projectRoot, 'assets/android-icon-background.png'));
  errors.push('assets/android-icon-background.png still contains the retired starter artwork');
} catch {
  // The Android icon now uses a plain brand-ink background color.
}

const appConfig = JSON.parse(await readFile(resolve(projectRoot, 'app.json'), 'utf8'));
const expo = appConfig.expo;
const splashPlugin = expo.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
);
if (expo.icon !== './assets/icon.png')
  errors.push('The iPhone app icon is not the generated brand icon');
if (splashPlugin?.[1]?.image !== './assets/splash-icon.png')
  errors.push('The launch screen is not the generated brand mark');
if (expo.web?.favicon !== './assets/favicon.png')
  errors.push('The browser tab icon is not the generated brand mark');
if (expo.android?.adaptiveIcon?.backgroundColor?.toLowerCase() !== '#11150f') {
  errors.push('The Android icon background is not brand ink');
}
if (expo.android?.adaptiveIcon?.backgroundImage) {
  errors.push('The Android icon still points at the retired background artwork');
}
if (expo.android?.adaptiveIcon?.foregroundImage !== './assets/android-icon-foreground.png') {
  errors.push('The Android app icon is not the generated brand mark');
}
if (expo.android?.adaptiveIcon?.monochromeImage !== './assets/android-icon-monochrome.png') {
  errors.push('The Android monochrome icon is not the generated brand mark');
}

const manifest = JSON.parse(await readFile(resolve(projectRoot, 'public/manifest.json'), 'utf8'));
for (const [src, sizes] of [
  ['/icon-192.png?brand=twin-peaks', '192x192'],
  ['/icon-512.png?brand=twin-peaks', '512x512'],
]) {
  const icon = manifest.icons?.find((candidate) => candidate.src === src);
  if (
    !icon ||
    icon.sizes !== sizes ||
    icon.type !== 'image/png' ||
    icon.purpose !== 'any maskable'
  ) {
    errors.push(`The saved-site manifest does not publish ${src} for normal and shaped icons`);
  }
}

const appSource = await readFile(resolve(projectRoot, 'App.tsx'), 'utf8');
if (
  !appSource.includes("link.rel = 'apple-touch-icon'") ||
  !appSource.includes("link.href = '/apple-touch-icon.png?brand=twin-peaks'")
) {
  errors.push('The web page does not name the iPhone saved-site icon');
}
if (!appSource.includes("link.href = '/manifest.json?brand=twin-peaks'")) {
  errors.push('The web page does not request the current saved-site manifest');
}

const primitiveSource = await readFile(resolve(projectRoot, 'src/theme/primitives.tsx'), 'utf8');
if (!primitiveSource.includes(`const MARK_PATH = '${MARK_PATH}'`)) {
  errors.push('The in-page logo and generated app icons do not use the same mark');
}

if (errors.length > 0) {
  throw new Error(`Brand asset check failed:\n- ${errors.join('\n- ')}`);
}

console.log(`Brand asset check passed: ${BRAND_ASSETS.length} generated brand files`);
