import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

export const BRAND_GREEN = [46, 212, 126];
export const BRAND_INK = [17, 21, 15];
export const MARK_PATH = 'M0 82 L38 0 L38 82 Z M84 82 L46 0 L46 82 Z';

export const BRAND_ASSETS = [
  { path: 'assets/favicon.png', size: 512, background: null, color: BRAND_GREEN, scale: 0.78 },
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
];

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sampleOffsets = [0.125, 0.375, 0.625, 0.875];

function triangleContains(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const edge = (x1, y1, x2, y2, x, y) => (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  const d1 = edge(ax, ay, bx, by, px, py);
  const d2 = edge(bx, by, cx, cy, px, py);
  const d3 = edge(cx, cy, ax, ay, px, py);
  return (d1 <= 0 && d2 <= 0 && d3 <= 0) || (d1 >= 0 && d2 >= 0 && d3 >= 0);
}

export function renderBrandAsset({ size, background, color, scale }) {
  const png = new PNG({ width: size, height: size });
  const markHeight = size * scale;
  const markWidth = markHeight * (84 / 82);
  const left = (size - markWidth) / 2;
  const top = (size - markHeight) / 2;
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

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
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
      const index = (y * size + x) * 4;
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
