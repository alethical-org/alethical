import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const search = readFileSync(join(SRC, 'screens/redesign/SearchBillsScreen.tsx'), 'utf8');

describe('bill Search scope', () => {
  it('defaults every Search path to the whole current Legislature', () => {
    expect(search).toContain(
      "const legislatureScope = params.scope === 'legislature' || !session;",
    );
    expect(search).toContain("scope: legislatureScope ? 'legislature' : undefined");
    expect(search).toContain("selectedValue={legislatureScope ? '__legislature' : sessionSlug}");
  });

  it('shows Ask handoffs as Issue filters, never Topic filters', () => {
    expect(search).not.toContain('label: `Topic:');
    expect(search).toContain('label: `Issue:');
  });
});
