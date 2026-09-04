import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const bundleFiles = (await readdir(bundleDirectory)).filter((file) => file.endsWith('.js'));

if (bundleFiles.length === 0) {
  throw new Error('The web build produced no JavaScript files.');
}

// Every file, not just the first one every page loads: since #1966 each screen
// arrives in its own piece, and the full icon registry would be just as heavy
// hiding in one of those.
for (const file of bundleFiles) {
  const bundle = await readFile(new URL(file, bundleDirectory), 'utf8');

  if (bundle.includes('lucide-react-native')) {
    throw new Error(
      `The full lucide-react-native registry is in ${file}. Use apps/frontend/src/components/icons.tsx instead.`,
    );
  }
}

console.log(`Icon bundle check passed: ${bundleFiles.length} files`);
