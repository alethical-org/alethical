# Fonts used to build the shared-link picture

These files let `scripts/generate-brand-assets.mjs` draw the same 1200×630 picture on every machine without reading fonts installed on that machine.

- `libre-franklin/LibreFranklin-Regular.ttf` and `LibreFranklin-Bold.ttf` come from the [Libre Franklin project](https://github.com/googlefonts/Libre-Franklin/tree/master/fonts/ttf).
- `space-grotesk/SpaceGrotesk-Medium.ttf` comes from the [Space Grotesk project](https://github.com/floriankarsten/space-grotesk/tree/master/fonts/ttf/static).
- Each family’s `OFL.txt` carries its SIL Open Font License 1.1 terms.

The website still loads its normal web fonts from Google Fonts. These committed copies exist only for the repeatable image build.
