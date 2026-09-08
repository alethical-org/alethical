export type SocialPlatform = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'tiktok' | 'youtube';

export type SocialAccount = {
  label: string;
  platform: SocialPlatform;
  url: string | null;
};

// This order is shared by every place that shows Alethical's social accounts.
// A null address keeps an announced account visible without making a broken link.
export const SOCIAL_ACCOUNTS: readonly SocialAccount[] = [
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
];
