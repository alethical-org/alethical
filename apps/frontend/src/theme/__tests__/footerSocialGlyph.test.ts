import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'primitives.tsx'),
  'utf8',
);

describe('shared footer social marks', () => {
  it('shows the bare LinkedIn letterform at the same visual size as its neighbors', () => {
    const linkedin = SOURCE.match(
      /if \(platform === 'linkedin'\) \{[\s\S]*?\n  \}\n  return \(/,
    )?.[0];

    expect(linkedin).toContain('width={19} height={19} viewBox="3 2.8 18 18"');
    expect(linkedin).not.toContain('M22.22 0H1.77');
  });
});
