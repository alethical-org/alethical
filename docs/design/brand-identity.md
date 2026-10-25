# Alethical brand identity and assets

Use the supplied files in [brand-assets](brand-assets/) without rebuilding, cropping, recoloring,
rotating, skewing or stretching the mark. Keep the internal seam fixed and empty. The mark needs
clear space of at least one quarter of its height on every side; its minimum size is 16 pixels.
A full symbol-and-wordmark lockup is at least 24 pixels tall.

## Supplied assets

| Use | White or transparent surface | Explicit black background |
| --- | --- | --- |
| Document wordmark | [White-background image](brand-assets/alethical_wordmark_white_gradient.png) | [Black-background image](brand-assets/alethical_wordmark_black_gradient.png) |
| Symbol and wordmark | [White lockup](brand-assets/lockup-gradient-white-bg.png) | [Black lockup](brand-assets/lockup-gradient-black-bg.png) |
| Symbol, wordmark and tagline | [White tagline lockup](brand-assets/lockup-tagline-gradient-white-bg.png) | [Black tagline lockup](brand-assets/lockup-tagline-gradient-black-bg.png) |
| Symbol | [White](brand-assets/mark-gradient-white-bg.png) or [transparent](brand-assets/mark-gradient-transparent.png) | [Black](brand-assets/mark-gradient-black-bg.png) |

The supplied gradient runs from `#19713b` at the bottom-left to `#35c068` at the top-right.
The wordmark's Space Grotesk treatment is contained in the images; it does not authorize rebuilding
report logos or using that face for document text. The identity reference used weight 300 with
wide tracking at large display sizes, and weight 500 with tighter tracking at small sizes.

The navigation reference places the mark at about 1.6 times wordmark cap height, with a gap about
0.47 times wordmark size. This describes that navigation treatment, not a new report requirement.
Favicon artwork fills its slot without widening the seam; transparent and dark-tile variants serve
different backgrounds. Brand motion references describe root, rise, bloom and rest; they do not
establish implemented behavior or authorize new animation.

## Scope and precedence

[Document presentation](document-presentation.md) owns report and deck treatment.
[Design principles](design-principles.md), [UI copy](ui-copy-guide.md) and the
[website tokens](../../apps/frontend/src/theme/tokens.ts) own current product behavior and values.
Use Libre Franklin with equal-width digits for numbers even where an older drawing uses a
monospace face. Do not copy older export examples over current product rules or infer that a
reference drawing proves the live app matches it. Keep explicit user overrides and Design's
approval boundaries.
