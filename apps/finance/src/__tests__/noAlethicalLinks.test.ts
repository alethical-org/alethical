// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Finance never links to alethical.com (docs/architecture/alethical-finance-architecture.md
// §7). An email address on that domain is a contact action, and the API host
// answers data requests; neither is a page a reader is sent to.
const APP = fileURLToPath(new URL('../..', import.meta.url));

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('links', () => {
  it('names no alethical.com page anywhere in the app', () => {
    const offending = files(APP)
      .filter((path) => /\.(tsx?|html|css|json|txt)$/.test(path))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8')
          .replace(/[\w.+-]+@alethical\.com/g, '')
          .replace(/https:\/\/api\.alethical\.com/g, '');
        return /alethical\.com/i.test(text) ? [relative(APP, path)] : [];
      });
    expect(offending).toEqual([]);
  });
});
