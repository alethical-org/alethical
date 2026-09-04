import { describe, expect, it } from 'vitest';

import { optimizeReleaseFiles } from '../optimize-release-program.mjs';

const BIG = 'function unusedHelper(alpha, beta) { return alpha + beta; }\n'.repeat(40);

function store(files: Record<string, string>) {
  const written: Record<string, string> = {};
  return {
    written,
    read: async (file: string) => files[file],
    write: async (file: string, code: string) => {
      written[file] = code;
    },
  };
}

describe('optimizeReleaseFiles', () => {
  it('shrinks every file the build wrote, not only the first-loaded one', async () => {
    const files = {
      'index-abc.js': `var a = 1;\n${BIG}`,
      'CommitteeListScreen-def.js': `var b = 2;\n${BIG}`,
      '__common-ghi.js': `var c = 3;\n${BIG}`,
    };
    const io = store(files);

    const results = await optimizeReleaseFiles(Object.keys(files), io);

    expect(Object.keys(io.written).sort()).toEqual(Object.keys(files).sort());
    for (const result of results) {
      expect(result.optimizedBytes).toBeLessThan(result.sourceBytes);
    }
  });

  it('leaves a file alone when it is already as small as it gets', async () => {
    const files = {
      'index-abc.js': `var a = 1;\n${BIG}`,
      'VoteDetailScreen-def.js': 'var b=2;',
    };
    const io = store(files);

    const results = await optimizeReleaseFiles(Object.keys(files), io);

    expect(io.written['VoteDetailScreen-def.js']).toBeUndefined();
    expect(results.find((r) => r.file === 'VoteDetailScreen-def.js')?.written).toBe(false);
  });

  it('refuses a build with no single first-loaded file', async () => {
    await expect(optimizeReleaseFiles(['CommitteeListScreen-def.js'], store({}))).rejects.toThrow(
      /1 first-loaded web JavaScript file/,
    );
    await expect(optimizeReleaseFiles(['index-a.js', 'index-b.js'], store({}))).rejects.toThrow(
      /1 first-loaded web JavaScript file/,
    );
  });

  it('refuses a build where the optimizer shrank nothing', async () => {
    await expect(
      optimizeReleaseFiles(['index-abc.js'], store({ 'index-abc.js': 'var a=1;' })),
    ).rejects.toThrow(/shrank no file/);
  });
});
