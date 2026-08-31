import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'TrackedBillsScreen.tsx'), 'utf8');

describe('Tracked Bills signed-out prompt', () => {
  it('opens general sign-in and returns to the tracked-bills page', () => {
    expect(source).toContain("openSignIn({ intent: 'nav', returnTo: '/tracked' })");
    expect(source).not.toContain("openSignIn({ intent: 'track', returnTo: '/tracked' })");
  });
});
