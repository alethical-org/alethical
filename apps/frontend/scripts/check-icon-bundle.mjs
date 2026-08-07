import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

if (bundleFiles.length !== 1) {
  throw new Error(
    `Expected 1 web JavaScript bundle, found ${bundleFiles.length}: ${bundleFiles.join(', ')}`,
  );
}

const bundle = await readFile(new URL(bundleFiles[0], bundleDirectory), 'utf8');

if (bundle.includes('lucide-react-native')) {
  throw new Error(
    'The full lucide-react-native registry is in the web bundle. Use apps/frontend/src/components/icons.tsx instead.',
  );
}

console.log(`Icon bundle check passed: ${bundleFiles[0]}`);
