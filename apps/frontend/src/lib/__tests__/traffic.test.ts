import { describe, expect, it } from 'vitest';

import { formatTrafficWindowEnd, redactTrafficUrl } from '../traffic';

describe('traffic display formatting and address redaction', () => {
  it('removes everything after the page path before a view is sent', () => {
    expect(redactTrafficUrl('https://www.alethical.com/ask?q=private#answer')).toBe(
      'https://www.alethical.com/ask',
    );
  });

  it('shows the last completed hour in Minnesota daylight time', () => {
    expect(formatTrafficWindowEnd('2026-08-15T13:00:00.000Z')).toBe('8:00 AM CT');
  });

  it('shows the last completed hour in Minnesota standard time', () => {
    expect(formatTrafficWindowEnd('2026-12-15T13:00:00.000Z')).toBe('7:00 AM CT');
  });
});
