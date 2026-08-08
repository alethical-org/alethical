import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

// The build helper is plain JavaScript because Vercel runs it directly with Node.
// @ts-ignore TypeScript does not need a declaration for this build-only module.
import { optimizeReleaseProgram } from '../../scripts/optimize-release-program.mjs';

describe('production program optimization', () => {
  it('shrinks the final website program without changing what it does', async () => {
    const source = `
      function add(first, second) {
        const unused = 'remove me';
        return first + second;
      }
      globalThis.answer = add(20, 22);
    `;

    const optimized = await optimizeReleaseProgram(source);
    const beforeContext: Record<string, unknown> = {};
    const afterContext: Record<string, unknown> = {};

    runInNewContext(source, beforeContext);
    runInNewContext(optimized, afterContext);

    expect(afterContext.answer).toBe(beforeContext.answer);
    expect(optimized.length).toBeLessThan(source.length);
  });
});
