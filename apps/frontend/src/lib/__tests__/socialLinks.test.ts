import { describe, expect, it } from 'vitest';

import { SOCIAL_ACCOUNTS } from '../socialLinks';

describe('shared social links', () => {
  it('uses one ordered list for every confirmed account', () => {
    expect(SOCIAL_ACCOUNTS).toEqual([
      {
        label: 'LinkedIn',
        platform: 'linkedin',
        url: 'https://www.linkedin.com/company/alethical',
      },
      {
        label: 'Facebook',
        platform: 'facebook',
        url: 'https://www.facebook.com/people/Alethical/61588261592240/',
      },
      { label: 'Instagram', platform: 'instagram', url: null },
      { label: 'X', platform: 'x', url: 'https://x.com/alethical' },
      {
        label: 'TikTok',
        platform: 'tiktok',
        url: 'https://www.tiktok.com/@alethicaltruth',
      },
      {
        label: 'YouTube',
        platform: 'youtube',
        url: 'https://www.youtube.com/@Alethical',
      },
    ]);
  });
});
