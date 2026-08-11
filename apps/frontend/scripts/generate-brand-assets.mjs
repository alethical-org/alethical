import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { Resvg } from '@resvg/resvg-js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BRAND_GREEN = [46, 212, 126];
export const BRAND_INK = [17, 21, 15];
export const MARK_PATH = 'M0 82 L38 0 L38 82 Z M84 82 L46 0 L46 82 Z';

export const BRAND_ASSETS = [
  // The browser tab / search-result icon. Both values below are load-bearing,
  // driven by how Google Search redraws a favicon. Measured against live Google
  // data Aug 2026; full evidence and the rejected alternative are in
  // docs/architecture/page-metadata-for-search-and-sharing-decisions.md §13.
  //  - `background` must stay opaque. Google trims a favicon's transparent margin
  //    away and rescales the artwork to fill the square, so padding inside a
  //    transparent icon is discarded: the mark ends up edge to edge, and the
  //    results page's circular crop then cuts its two bottom corners. An opaque
  //    square has no transparent margin to trim, so this framing survives.
  //  - `scale` must stay at or below 0.65. The mark's widest points are its bottom
  //    corners, sqrt(1 + (84/82)^2) / 2 = 0.716 of the mark's height from center,
  //    so a circular crop starts clipping them once the mark passes 0.699 of the
  //    canvas. 0.65 keeps a ~7% margin inside that circle.
  { path: 'assets/favicon.png', size: 512, background: BRAND_INK, color: BRAND_GREEN, scale: 0.65 },
  { path: 'assets/icon.png', size: 1024, background: BRAND_INK, color: BRAND_GREEN, scale: 0.52 },
  {
    path: 'assets/android-icon-foreground.png',
    size: 512,
    background: null,
    color: BRAND_GREEN,
    scale: 0.55,
  },
  {
    path: 'assets/android-icon-monochrome.png',
    size: 432,
    background: null,
    color: [0, 0, 0],
    scale: 0.55,
  },
  {
    path: 'assets/splash-icon.png',
    size: 1024,
    background: null,
    color: BRAND_GREEN,
    scale: 0.34,
  },
  {
    path: 'public/icon-192.png',
    size: 192,
    background: BRAND_INK,
    color: BRAND_GREEN,
    scale: 0.52,
  },
  {
    path: 'public/icon-512.png',
    size: 512,
    background: BRAND_INK,
    color: BRAND_GREEN,
    scale: 0.52,
  },
  {
    path: 'public/apple-touch-icon.png',
    size: 180,
    background: BRAND_INK,
    color: BRAND_GREEN,
    scale: 0.52,
  },
  {
    path: 'public/social-preview.png',
    kind: 'social-card',
    width: 1200,
    height: 630,
  },
];

const sampleOffsets = [0.125, 0.375, 0.625, 0.875];

function renderSocialPreviewAsset() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#11150f" />

      <g transform="translate(84 72) scale(0.48)" fill="#2ed47e">
        <path d="${MARK_PATH}" />
      </g>
      <text
        x="142"
        y="105"
        fill="#f8fbf9"
        font-family="Space Grotesk"
        font-size="28"
        font-weight="500"
        letter-spacing="4.48"
      >ALETHICAL</text>

      <g fill="#ffffff" font-family="Libre Franklin" font-size="64" font-weight="700">
        <text x="84" y="252">Minnesota’s legislative</text>
        <text x="84" y="328">record in plain language.</text>
      </g>
      <text
        x="84"
        y="416"
        fill="#eaf6ef"
        font-family="Libre Franklin"
        font-size="30"
        font-weight="400"
      >With links to official sources.</text>

      <g transform="translate(910 194) scale(2.92)" fill="#2ed47e">
        <path d="${MARK_PATH}" />
      </g>
    </svg>
  `;
  const fontFiles = [
    resolve(projectRoot, 'assets/fonts/libre-franklin/LibreFranklin-Regular.ttf'),
    resolve(projectRoot, 'assets/fonts/libre-franklin/LibreFranklin-Bold.ttf'),
    resolve(projectRoot, 'assets/fonts/space-grotesk/SpaceGrotesk-Medium.ttf'),
  ];
  return new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false },
  })
    .render()
    .asPng();
}

function triangleContains(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const edge = (x1, y1, x2, y2, x, y) => (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  const d1 = edge(ax, ay, bx, by, px, py);
  const d2 = edge(bx, by, cx, cy, px, py);
  const d3 = edge(cx, cy, ax, ay, px, py);
  return (d1 <= 0 && d2 <= 0 && d3 <= 0) || (d1 >= 0 && d2 >= 0 && d3 >= 0);
}

export function renderBrandAsset(asset) {
  if (asset.kind === 'social-card') {
    return renderSocialPreviewAsset();
  }

  const { size, width = size, height = size, background, color, scale } = asset;
  const png = new PNG({ width, height });
  const markHeight = Math.min(width, height) * scale;
  const markWidth = markHeight * (84 / 82);
  const left = (width - markWidth) / 2;
  const top = (height - markHeight) / 2;
  const leftTop = left + markWidth * (38 / 84);
  const rightTop = left + markWidth * (46 / 84);
  const bottom = top + markHeight;
  const triangles = [
    [
      [left, bottom],
      [leftTop, top],
      [leftTop, bottom],
    ],
    [
      [left + markWidth, bottom],
      [rightTop, top],
      [rightTop, bottom],
    ],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (const offsetY of sampleOffsets) {
        for (const offsetX of sampleOffsets) {
          if (
            triangles.some((triangle) => triangleContains(x + offsetX, y + offsetY, ...triangle))
          ) {
            covered += 1;
          }
        }
      }

      const coverage = covered / (sampleOffsets.length * sampleOffsets.length);
      const index = (y * width + x) * 4;
      if (background) {
        png.data[index] = Math.round(background[0] * (1 - coverage) + color[0] * coverage);
        png.data[index + 1] = Math.round(background[1] * (1 - coverage) + color[1] * coverage);
        png.data[index + 2] = Math.round(background[2] * (1 - coverage) + color[2] * coverage);
        png.data[index + 3] = 255;
      } else {
        png.data[index] = color[0];
        png.data[index + 1] = color[1];
        png.data[index + 2] = color[2];
        png.data[index + 3] = Math.round(255 * coverage);
      }
    }
  }

  return PNG.sync.write(png, { colorType: background ? 2 : 6 });
}

async function generate() {
  for (const asset of BRAND_ASSETS) {
    const outputPath = resolve(projectRoot, asset.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderBrandAsset(asset));
    console.log(`Generated ${asset.path}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate();
}
