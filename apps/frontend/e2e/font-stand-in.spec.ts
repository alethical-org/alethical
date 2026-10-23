import { expect, test } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

// Libre Franklin's stand-in may only cover characters Libre Franklin itself
// draws. Any other character would switch from the browser's default font to a
// scaled Arial on every page, even with Libre Franklin loaded. Its 2 faces
// declare wider ranges than their files contain, so the stand-in's range comes
// from the files' character maps, and this check holds it there.

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

test('the Libre Franklin stand-in covers only characters Libre Franklin draws', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const faces = [...document.fonts].filter(
      (face) => face.family.replace(/"/g, '') === 'Libre Franklin Fallback',
    );
    const points = new Set<number>();
    for (const face of faces) {
      for (const part of face.unicodeRange.split(',')) {
        const [start, end] = part.trim().slice(2).split('-');
        const first = parseInt(start, 16);
        const last = end ? parseInt(end, 16) : first;
        for (let point = first; point <= last; point += 1) points.add(point);
      }
    }
    const all = [...points];
    const missing = 'Ǎ‰‡';
    await document.fonts.load("400 40px 'Libre Franklin'", String.fromCodePoint(...all) + missing);
    const context = document.createElement('canvas').getContext('2d')!;
    // A character Libre Franklin draws measures the same whatever font follows it.
    const drawn = (text: string) => {
      context.font = "40px 'Libre Franklin', monospace";
      const first = context.measureText(text).width;
      context.font = "40px 'Libre Franklin', serif";
      return first === context.measureText(text).width;
    };
    return {
      faces: faces.length,
      points: all.length,
      notDrawn: all
        .filter((point) => !drawn(String.fromCodePoint(point)))
        .map((p) => p.toString(16)),
      controlDetected: [...missing].every((text) => !drawn(text)),
    };
  });

  expect(result.faces).toBe(5);
  expect(result.points).toBeGreaterThan(400);
  // The measurement can tell a character Libre Franklin lacks.
  expect(result.controlDetected).toBe(true);
  expect(result.notDrawn).toEqual([]);
});
