import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Bill Detail's Share control, lifted out of BillHeader so the Ask answer page
// uses the SAME button and popover rather than a lookalike (grounded-ask-spec
// §9.5 decision 10 — "Bill Detail's exact button and popover"). Only the sheet's
// own title varies ("Share this bill" / "Share this answer"), which is also the
// button's and the dialog's accessible name.
//
// Layering is load-bearing and is specified because it has shipped broken twice
// (Legislator Profile session filter; Bill Search "Sorted by" menu): the wrapper
// is position:relative z-index 60, the panel position:absolute z-index 1, and the
// backdrop position:fixed z-index 0. Nothing painted after it in the DOM may open
// a competing stacking context.

export function SharePopover({
  url,
  title,
  subject,
}: {
  url: string;
  title: string;
  /** What is being shared, for the button label and the sheet heading. */
  subject: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const enc = encodeURIComponent;
  const intents = {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(`${title} · Alethical`)}&url=${enc(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    instagram: 'https://www.instagram.com/',
    email: `mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}\n\nvia Alethical`)}`,
  };

  const copy = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1900);
  };

  const openIntent = (href: string) => {
    if (isWeb && typeof window !== 'undefined') {
      window.open(href, '_blank', 'noopener');
    } else {
      Linking.openURL(href).catch(() => {});
    }
  };

  return (
    <View style={styles.shareWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Share this ${subject}`}
        aria-expanded={open}
        onPress={() => {
          setOpen((v) => !v);
          setCopied(false);
        }}
        {...btnHover}
        style={[styles.shareBtn, btnHovered && styles.shareBtnHover]}
      >
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
          <Circle cx={18} cy={5} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={6} cy={12} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={18} cy={19} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Path
            d="M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5"
            stroke={t.colors.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <Text style={styles.shareBtnText}>Share</Text>
      </Pressable>

      {open ? (
        <>
          {/* transparent backdrop closes on outside click */}
          <Pressable
            accessibilityLabel="Close share"
            style={styles.shareBackdrop}
            onPress={() => setOpen(false)}
          />
          <View
            accessibilityRole={isWeb ? undefined : 'menu'}
            aria-label={`Share this ${subject}`}
            style={[styles.sharePanel, isWeb ? (styles.sharePanelWeb as object) : null]}
          >
            <View style={styles.sharePanelHead}>
              <Text style={styles.sharePanelTitle}>{`Share this ${subject}`}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                style={styles.shareClose}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M6 6 L18 18 M18 6 L6 18"
                    stroke={t.colors.text.muted}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            </View>

            <View style={styles.shareUrlRow}>
              <TextInput
                value={url}
                editable={false}
                accessibilityLabel={`${subject.charAt(0).toUpperCase()}${subject.slice(1)} link`}
                style={[styles.shareUrlInput, isWeb ? ({ outlineStyle: 'none' } as object) : null]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={copy}
                style={[styles.shareCopyBtn, copied && styles.shareCopyBtnCopied]}
              >
                {copied ? (
                  <>
                    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M5 12.5 L10 17.5 L19 7"
                        stroke={t.colors.text.onGreen}
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                    <Text style={styles.shareCopyText}>Copied</Text>
                  </>
                ) : (
                  <Text style={styles.shareCopyText}>Copy</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.shareSocialSection}>
              <Text style={styles.shareSocialLabel}>SHARE TO</Text>
              <View style={styles.shareSocialRow}>
                <SocialButton
                  label="Share on LinkedIn"
                  onPress={() => openIntent(intents.linkedin)}
                >
                  <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </SocialButton>
                <SocialButton label="Share on X" onPress={() => openIntent(intents.x)}>
                  <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </SocialButton>
                <SocialButton
                  label="Share on Facebook"
                  onPress={() => openIntent(intents.facebook)}
                >
                  <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
                </SocialButton>
                <SocialButton
                  label="Share on Instagram"
                  onPress={() => openIntent(intents.instagram)}
                >
                  <Path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-10.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
                </SocialButton>
                <SocialButton
                  label="Share by email"
                  onPress={() => openIntent(intents.email)}
                  stroke
                >
                  <Path
                    d="M3 6.5 h18 v11 h-18 Z M4 7.5 L12 13 L20 7.5"
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </SocialButton>
              </View>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function SocialButton({
  label,
  onPress,
  children,
  stroke,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  stroke?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hover}
      style={[styles.social, hovered && styles.socialHover]}
    >
      <Svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill={stroke ? 'none' : t.colors.text.primary}
      >
        {children}
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shareWrap: {
    position: 'relative',
    zIndex: 60,
    marginBottom: 10,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    // Leading share glyph, so 3px less on the left (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 17,
    paddingRight: 20,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
  },
  shareBtnHover: {
    borderColor: t.colors.alpha.ink32,
    backgroundColor: t.colors.surfaces.s200,
  },
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  shareBackdrop: {
    ...(StyleSheet.absoluteFillObject as object),
    position: (isWeb ? 'fixed' : 'absolute') as 'absolute',
    top: -2000,
    left: -2000,
    right: -2000,
    bottom: -2000,
    zIndex: 0,
  },
  sharePanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 12,
    zIndex: 1,
    width: 366,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.xl,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    ...(t.shadows.lg as object),
  },
  sharePanelWeb: { boxShadow: '0 24px 60px rgba(17,21,15,0.2)' },
  sharePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sharePanelTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  shareClose: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.sm,
  },
  shareUrlRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 14,
  },
  shareUrlInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.secondary,
  },
  shareCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  // Copied state adds a leading checkmark glyph, so 3px less on the left
  // (docs/design/design-principles.md §2, Optical centering). The plain "Copy"
  // text state has no icon, so the base style stays untrimmed for it.
  shareCopyBtnCopied: { paddingLeft: 13 },
  shareCopyText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  shareSocialSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  shareSocialLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  shareSocialRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  social: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialHover: {
    backgroundColor: '#e7e8ec',
  },
});
