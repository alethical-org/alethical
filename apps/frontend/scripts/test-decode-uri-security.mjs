import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyDecodeRepairFiles } from './check-decode-uri-security.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../../..', import.meta.url).pathname;
const navigationRequire = createRequire(require.resolve('@react-navigation/core'));
const queryRequire = createRequire(navigationRequire.resolve('query-string'));
const decoder = queryRequire.resolve('decode-uri-component');

for (const mutation of ['none', 'patch', 'workspace', 'lock', 'installed']) {
  test(`decode repair ${mutation === 'none' ? 'accepts the exact backport' : `rejects changed ${mutation}`}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'decode-repair-'));
    try {
      mkdirSync(join(directory, 'patches'));
      for (const file of [
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
        'patches/decode-uri-component@0.5.0.patch',
      ])
        cpSync(join(root, file), join(directory, file));
      const installed = join(directory, 'index.js');
      cpSync(decoder, installed);
      const path =
        mutation === 'patch'
          ? join(directory, 'patches/decode-uri-component@0.5.0.patch')
          : mutation === 'workspace'
            ? join(directory, 'pnpm-workspace.yaml')
            : mutation === 'lock'
              ? join(directory, 'pnpm-lock.yaml')
              : installed;
      if (mutation !== 'none') {
        let text = readFileSync(path, 'utf8');
        if (mutation === 'workspace')
          text = text.replace(/^  decode-uri-component@0\.5\.0:.*\n/m, '');
        else if (mutation === 'lock')
          text = text.replace(
            /(  decode-uri-component@0\.5\.0:\n    hash: )[a-f0-9]+/,
            `$1${'0'.repeat(64)}`,
          );
        else text += '\n';
        writeFileSync(path, text);
        assert.throws(() => verifyDecodeRepairFiles(directory, installed));
      } else verifyDecodeRepairFiles(directory, installed);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
