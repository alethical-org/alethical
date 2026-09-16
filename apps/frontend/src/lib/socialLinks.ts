export type SocialPlatform = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'tiktok' | 'youtube';

export type SocialAccount = {
  label: string;
  platform: SocialPlatform;
  url: string;
};

// This order is shared by every place that shows Alethical's social accounts.
// An account joins the list only once its page exists, so every mark is clickable.
// Instagram is held out until its page is ready; its mark stays in SocialIconLink.tsx.
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
