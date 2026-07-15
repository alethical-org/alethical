import { Platform } from 'react-native';

// Design tokens for the redesign, extracted verbatim from docs/mockups/*.html
// (verified across all 7 screens). Existing key names are preserved so the
// current screens keep compiling; new ramps/groups are added for the primitives
// and the new screens. Fonts (Libre Franklin, JetBrains Mono) are loaded on web
// via the font <link> in the web entry; see the primitives/build for wiring.

// --- Raw palette (literal values from the mockups) ---
const palette = {
  // ink / text ramp — green-black to faint
  ink900: '#0a0e0c',
  ink800: '#11150f',
  ink700: '#1a201d',
  ink500: '#4b524b',
  ink450: '#4f5651',
  ink400: '#6b716b',
  // ink300/ink200 back only text.muted/text.faint; darkened from #7c847f/#9aa39e
  // to meet WCAG AA on white — muted 5.4:1, faint 4.61:1 (a11y pass, #193).
  ink300: '#656c66',
  ink200: '#70776f',
  // green ramp — bright fill to deep text/darker
  green300: '#3de08a',
  green400: '#2ed47e',
  green500: '#28bf71',
  green600: '#149d5b',
  green700: '#0f7a45',
  green800: '#11332a',
  green900: '#06231a',
  // green tints / green-tinted surfaces
  greenTint50: '#f2f9f5',
  greenTint100: '#eaf6ef',
  greenTint150: '#e4f8ee',
  greenTint200: '#dcf1e5',
  greenTint300: '#cbeed6',
  greenBorder: '#bfeacf',
  // neutral surfaces (light → tint)
  white: '#ffffff',
  surface50: '#fdfdfe',
  surface100: '#fbfcfd',
  surface200: '#f7f8fa',
  surface250: '#f6f7f8',
  surface300: '#f4f5f7',
  surface400: '#f1f1f4',
  // borders
  border: '#cfd6d2',
  border2: '#d3d7d3',
  border3: '#c3c9c4',
  borderStrong: '#b7bdb8',
  // danger red ramp
  red200: '#ff8a80',
  red400: '#e2544e',
  red600: '#c23c36',
  red800: '#5c2b2e',
  red900: '#2a1215',
  // v2 home (docs/mockups/home-signed-out-v2): purple = AI / "Grounded Ask" / focus,
  // status colors for bill cards, dark footer surface
  purple: '#5b30d6',
  purpleTint: '#f0ebfc',
  purpleBorder: '#d8c9f7',
  vetoedText: '#d64545',
  vetoedStep: '#e5484d',
  amber: '#9a7b1f',
  progressEmpty: '#e2e5e4',
  // omnibus indicator pill (docs/mockups/search-bills omnibus amber).
  // Text darkened from the mockup's #a76a1a to clear WCAG AA (4.5:1): #8f5a12 on
  // the #fbf1e2 fill is 5.16:1; #a76a1a was 3.98:1, short for 11px text.
  omnibusFill: '#fbf1e2',
  omnibusBorder: '#f0d6a8',
  omnibusText: '#8f5a12',
};

// --- Alpha ramps (ink for borders/overlays, green for glows, white) ---
const alpha = {
  ink06: 'rgba(17,21,15,0.06)',
  ink07: 'rgba(17,21,15,0.07)',
  ink08: 'rgba(17,21,15,0.08)',
  ink10: 'rgba(17,21,15,0.10)',
  ink12: 'rgba(17,21,15,0.12)',
  ink14: 'rgba(17,21,15,0.14)',
  ink16: 'rgba(17,21,15,0.16)',
  ink18: 'rgba(17,21,15,0.18)',
  ink20: 'rgba(17,21,15,0.20)',
  ink25: 'rgba(17,21,15,0.25)',
  ink28: 'rgba(17,21,15,0.28)',
  ink32: 'rgba(17,21,15,0.32)',
  green10: 'rgba(45,212,126,0.10)',
  green12: 'rgba(45,212,126,0.12)',
  green18: 'rgba(45,212,126,0.18)',
  white90: 'rgba(255,255,255,0.90)',
  white12: 'rgba(255,255,255,0.12)',
  white14: 'rgba(255,255,255,0.14)',
};

const webFont = (stack: string) =>
  Platform.select({ web: stack, ios: 'System', default: 'sans-serif' }) as string;

// True when the user has asked the OS/browser to minimize motion (web only). Gate
// decorative CSS transitions on this to honor "prefers-reduced-motion" (#193).
export const prefersReducedMotion = (): boolean =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const theme = {
  colors: {
    // --- Legacy keys (remapped to the green system; kept so current screens compile) ---
    ink: palette.ink800,
    mutedInk: palette.ink450,
    paper: palette.surface300,
    surface: palette.white,
    surfaceAlt: palette.surface400,
    border: palette.border,
    primary: palette.ink800,
    primarySoft: palette.surface400,
    accent: palette.green400, // green FILL / CTA (was #CC0000)
    accentSoft: palette.greenTint150,
    info: palette.ink800,
    infoSoft: palette.surface400,
    success: palette.green600,
    warning: palette.ink800, // not defined in mockups — neutral placeholder
    danger: palette.red600,
    focus: palette.green400,
    white: palette.white,

    // --- New role groups ---
    text: {
      primary: palette.ink800,
      secondary: palette.ink450,
      muted: palette.ink300,
      faint: palette.ink200,
      onGreen: palette.ink800, // dark ink on green fills (confirmed)
      green: palette.green600, // green TEXT / links / labels
    },
    brand: {
      bright: palette.green300,
      base: palette.green400, // fills / CTAs
      hover: palette.green500,
      deep: palette.green600, // text on light
      forest: palette.green700,
      darkest: palette.green900,
    },
    tint: {
      t50: palette.greenTint50,
      t100: palette.greenTint100,
      t150: palette.greenTint150, // badge fill
      t200: palette.greenTint200,
      t300: palette.greenTint300,
      border: palette.greenBorder, // badge border
    },
    surfaces: {
      base: palette.white,
      s50: palette.surface50,
      s100: palette.surface100,
      s200: palette.surface200,
      s250: palette.surface250,
      s300: palette.surface300,
      s400: palette.surface400,
    },
    borders: {
      base: palette.border,
      b2: palette.border2,
      b3: palette.border3,
      strong: palette.borderStrong,
    },
    dangerRamp: {
      r200: palette.red200,
      r400: palette.red400,
      r600: palette.red600,
      r800: palette.red800,
      r900: palette.red900,
    },
    // v2 home: AI/"Grounded Ask" purple family (also chip hover + field focus)
    purple: {
      base: palette.purple,
      tint: palette.purpleTint,
      border: palette.purpleBorder,
    },
    // v2 home: bill-card status colors
    status: {
      vetoedText: palette.vetoedText,
      vetoedStep: palette.vetoedStep,
      amber: palette.amber,
      progressEmpty: palette.progressEmpty,
    },
    // omnibus indicator pill on bill cards
    omnibus: {
      fill: palette.omnibusFill,
      border: palette.omnibusBorder,
      text: palette.omnibusText,
    },
    footerBg: palette.ink900,
    alpha,
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radii: {
    // legacy keys kept; values updated to the real scale
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
    // new steps
    xs: 6,
    badge: 7,
    chip: 12,
    card: 12,
    xl: 20,
    circle: '50%',
  },
  typography: {
    title: webFont("'Libre Franklin', Helvetica, Arial, sans-serif"),
    body: webFont("'Libre Franklin', Helvetica, Arial, sans-serif"),
    ui: webFont("'Libre Franklin', Helvetica, Arial, sans-serif"),
    mono: webFont("'JetBrains Mono', 'Courier New', monospace"),
    // v2 home: the "Grounded Ask" pill only
    sora: webFont("'Sora', 'Libre Franklin', Helvetica, Arial, sans-serif"),
  },
  fontSizes: {
    caption: 11,
    label: 12,
    meta: 13,
    small: 14,
    body: 15,
    bodyLg: 16,
    lg: 17,
    subhead: 18,
    subheadLg: 19,
    h4: 20,
    h3: 22,
    h2: 25,
    h1: 28,
    display: 34,
    displayLg: 44,
    hero: 52,
    heroLg: 64,
    heroXl: 72,
  },
  fontWeights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    heavy: '800' as const,
    black: '900' as const,
  },
  letterSpacing: {
    heroTight: '-0.02em',
    tight: '-0.01em',
    normal: '0',
    label: '0.08em',
    labelWide: '0.1em',
    labelWider: '0.16em',
  },
  gradients: {
    // page background: green radial wash (top-right) over a light vertical gradient
    page: 'radial-gradient(120% 90% at 88% -10%, rgba(45,212,126,0.10) 0%, rgba(45,212,126,0.0) 45%), linear-gradient(180deg,#f4f5f7 0%,#f7f8fa 60%,#fdfdfe 92%,#ffffff 100%)',
    // greener page variant (find-my-legislator / legislator)
    pageGreen: 'linear-gradient(180deg,#eaf6ef 0%,#f2f9f5 45%,#ffffff 100%)',
    // dot-grid textures
    dotInk: 'radial-gradient(rgba(17,21,15,0.07) 1.4px, transparent 1.5px)',
    dotGreen: 'radial-gradient(rgba(20,157,91,0.09) 1.3px, transparent 1.4px)',
    // green glow
    glow: 'radial-gradient(50% 50% at 50% 50%, rgba(45,212,126,0.12) 0%, rgba(45,212,126,0) 70%)',
  },
  shadows: {
    sm: Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 1,
      },
    }),
    raised: Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
    card: Platform.select({
      web: { boxShadow: '0 8px 24px rgba(17,21,15,0.06)' },
      default: {
        shadowColor: '#11150f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 24,
        elevation: 3,
      },
    }),
    md: Platform.select({
      web: { boxShadow: '0 2px 8px rgba(17,21,15,0.16)' },
      default: {
        shadowColor: '#11150f',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 8,
        elevation: 4,
      },
    }),
    lg: Platform.select({
      web: { boxShadow: '0 18px 44px rgba(17,21,15,0.08)' },
      default: {
        shadowColor: '#11150f',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.08,
        shadowRadius: 44,
        elevation: 8,
      },
    }),
    focus: Platform.select({
      web: { boxShadow: '0 0 0 3px rgba(45,212,126,0.18)' },
      default: {
        shadowColor: '#2ed47e',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 3,
        elevation: 0,
      },
    }),
    // v2 home: nav dropdown panel (three-layer stack)
    panel: Platform.select({
      web: {
        boxShadow:
          '0 1px 2px rgba(17,21,15,0.10), 0 12px 26px rgba(17,21,15,0.16), 0 40px 80px rgba(17,21,15,0.32)',
      },
      default: {
        shadowColor: '#11150f',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 26,
        elevation: 12,
      },
    }),
    // v2 home glows: purple (hero/city chips hover, field focus ring), green (capability card hover)
    glowPurple: Platform.select({
      web: { boxShadow: '0 0 0 3px rgba(91,48,214,0.14), 0 0 16px rgba(91,48,214,0.4)' },
      default: {
        shadowColor: '#5b30d6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 0,
      },
    }),
    focusPurple: Platform.select({
      web: { boxShadow: '0 0 0 4px rgba(91,48,214,0.14)' },
      default: {
        shadowColor: '#5b30d6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.14,
        shadowRadius: 4,
        elevation: 0,
      },
    }),
    glowGreen: Platform.select({
      web: { boxShadow: '0 0 0 3px rgba(46,212,126,0.12), 0 0 14px rgba(46,212,126,0.32)' },
      default: {
        shadowColor: '#2ed47e',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.32,
        shadowRadius: 14,
        elevation: 0,
      },
    }),
  },
  layout: {
    maxWidth: 1280,
    railWidth: 320,
  },
};

export type Theme = typeof theme;
