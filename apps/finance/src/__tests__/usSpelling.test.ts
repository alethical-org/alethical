import { describe, expect, it } from 'vitest';

import { LOBBYING_DIRECTORY_COPY } from '@alethical/shared/lobbyingDirectoryCopy';
import { RACE_DONOR_EXPLANATION } from '@alethical/shared/moneyByRace';

describe('US spelling', () => {
  it('prints "organization" in the shared wording Finance imports', () => {
    expect(JSON.stringify(LOBBYING_DIRECTORY_COPY)).not.toMatch(/organis/i);
    expect(JSON.stringify(LOBBYING_DIRECTORY_COPY)).toMatch(/organization/);
    expect(RACE_DONOR_EXPLANATION).toContain('party organizations');
  });
});
