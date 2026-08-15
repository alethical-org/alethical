import { describe, expect, it } from 'vitest';

import { redactTrafficUrl, trafficMethodNote } from '../traffic';

describe('traffic privacy wording and address redaction', () => {
  it('removes everything after the page path before a view is sent', () => {
    expect(redactTrafficUrl('https://www.alethical.com/ask?q=private#answer')).toBe(
      'https://www.alethical.com/ask',
    );
  });

  it('does not claim team traffic is excluded before the account list exists', () => {
    const note = trafficMethodNote(false);
    expect(note).not.toContain('Alethical team accounts');
    expect(note).toContain('Numbers refresh every few minutes.');
  });

  it('adds the narrow signed-in exclusion claim after the account list exists', () => {
    expect(trafficMethodNote(true)).toContain(
      'Browsing while signed into Alethical team accounts is not counted.',
    );
  });
});
