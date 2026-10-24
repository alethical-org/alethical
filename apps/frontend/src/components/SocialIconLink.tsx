import { useState } from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useFineHover, useHover } from './billDetail/interactions';
import { SocialAccount, SocialPlatform } from '../lib/socialLinks';
import { externalLinkProps } from '../navigation/links';
import { theme as t } from '../theme/tokens';

type SocialSurface = 'footer' | 'contact' | 'hero';

const GLYPH_SIZES: Record<SocialSurface, Record<SocialPlatform, number>> = {
  footer: {
    linkedin: 21,
    facebook: 23,
    instagram: 22,
    x: 20,
    bluesky: 20,
    tiktok: 20,
    youtube: 23,
  },
  contact: {
    linkedin: 22,
    facebook: 24,
    instagram: 23,
    x: 21,
    bluesky: 21,
    tiktok: 21,
    youtube: 24,
  },
  // Homepage hero, computer and tablet; phone draws each mark 2px larger.
  hero: {
    linkedin: 18,
    facebook: 20,
    instagram: 19,
    x: 17,
    bluesky: 17,
    tiktok: 18,
    youtube: 20,
  },
};

function SocialGlyph({
  platform,
  size,
  color,
}: {
  platform: SocialPlatform;
  size: number;
  color: string;
}) {
  if (platform === 'linkedin') {
    return (
      <Svg width={size} height={size} viewBox="0.87 2.87 22 22" fill={color} aria-hidden>
        <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z" />
      </Svg>
    );
  }
  if (platform === 'facebook') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
        <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
      </Svg>
    );
  }
  if (platform === 'instagram') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
        <Path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.336 3.608 1.311.975.975 1.249 2.242 1.311 3.608.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.062 1.366-.336 2.633-1.311 3.608-.975.975-2.242 1.249-3.608 1.311-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.366-.062-2.633-.336-3.608-1.311-.975-.975-1.249-2.242-1.311-3.608C2.175 15.584 2.163 15.204 2.163 12s.012-3.584.07-4.85c.062-1.366.336-2.633 1.311-3.608.975-.975 2.242-1.249 3.608-1.311C8.416 2.175 8.796 2.163 12 2.163zm0 1.802c-3.148 0-3.5.012-4.737.068-.94.043-1.75.213-2.31.773-.56.56-.73 1.37-.773 2.31-.056 1.237-.068 1.589-.068 4.737s.012 3.5.068 4.737c.043.94.213 1.75.773 2.31.56.56 1.37.73 2.31.773 1.237.056 1.589.068 4.737.068s3.5-.012 4.737-.068c.94-.043 1.75-.213 2.31-.773.56-.56.73-1.37.773-2.31.056-1.237.068-1.589.068-4.737s-.012-3.5-.068-4.737c-.043-.94-.213-1.75-.773-2.31-.56-.56-1.37-.73-2.31-.773-1.237-.056-1.589-.068-4.737-.068zM12 6.865a5.135 5.135 0 1 1 0 10.27 5.135 5.135 0 0 1 0-10.27zm0 1.802a3.333 3.333 0 1 0 0 6.666 3.333 3.333 0 0 0 0-6.666zm5.338-3.205a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" />
      </Svg>
    );
  }
  if (platform === 'tiktok') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
        <Path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.6-1.62-.95-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </Svg>
    );
  }
  if (platform === 'bluesky') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
        <Path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.296 5.568-.628 6.383-3.364.246-.829.624-5.79.624-6.479 0-.688-.139-1.86-.902-2.203-.659-.299-1.664-.621-4.3 1.24C16.046 4.747 13.087 8.686 12 10.8z" />
      </Svg>
    );
  }
  if (platform === 'youtube') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
        <Path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </Svg>
  );
}

export function SocialIconLink({
  social,
  surface,
  mobile = false,
}: {
  social: SocialAccount;
  surface: SocialSurface;
  mobile?: boolean;
}) {
  const [hovered, hoverProps] = useHover();
  const [fineHovered, fineHoverProps] = useFineHover();
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const isFooter = surface === 'footer';
  const isHero = surface === 'hero';
  const baseStyles = [
    styles.link,
    isHero ? styles.hero : isFooter ? styles.footer : styles.contact,
    isFooter && mobile && styles.footerMobile,
    isHero && mobile && styles.heroMobile,
  ];
  const glyphSize = GLYPH_SIZES[surface][social.platform] + (isHero && mobile ? 2 : 0);

  const url = social.url;

  return (
    <Pressable
      accessibilityLabel={`Alethical on ${social.label} (opens in a new tab)`}
      {...(url ? externalLinkProps(url, () => void Linking.openURL(url)) : {})}
      {...(isHero ? fineHoverProps : hoverProps)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) =>
        isHero
          ? // The hero row is bare grey marks at rest; keyboard focus shows only the
            // site ring, and hover appears only where a mouse can hover.
            [...baseStyles, pressed ? styles.heroPressed : fineHovered && styles.heroHovered]
          : [
              ...baseStyles,
              (active || pressed) && (isFooter ? styles.footerActive : styles.contactActive),
            ]
      }
    >
      {({ pressed }) => (
        <SocialGlyph
          platform={social.platform}
          size={glyphSize}
          color={
            isHero
              ? pressed || fineHovered
                ? t.colors.ink
                : '#6b716b'
              : isFooter && (active || pressed)
                ? '#ffffff'
                : isFooter
                  ? '#eef1ef'
                  : t.colors.ink
          }
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignItems: 'center', justifyContent: 'center' },
  footer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  footerMobile: { width: 44, height: 44, borderRadius: 22 },
  footerActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  contact: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colors.surfaces.s400,
  },
  contactActive: { backgroundColor: '#e7e8ec' },
  hero: { width: 40, height: 40, borderRadius: 20 },
  heroMobile: { width: 44, height: 44, borderRadius: 22 },
  heroHovered: { backgroundColor: 'rgba(17,21,15,0.06)' },
  heroPressed: { backgroundColor: 'rgba(17,21,15,0.1)' },
});
