import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(
  resolve(here, '../../screens/redesign/SearchBillsScreen.tsx'),
  'utf8',
);
const cardSource = readFileSync(
  resolve(here, '../../components/search/BillResultCard.tsx'),
  'utf8',
);

describe('Search Bills Track action at responsive widths', () => {
  it('wires every result card to Track without a desktop-only gate', () => {
    const cardStart = screenSource.indexOf('<BillResultCard');
    const cardEnd = screenSource.indexOf('/>', cardStart);
    const resultCard = screenSource.slice(cardStart, cardEnd);

    expect(resultCard).toContain('onToggleTrack=');
    expect(resultCard).not.toContain('showTrackButton');
    expect(screenSource).not.toContain('showTrackButton={isDesktop}');
  });

  it('keeps the shared card action visible by default in both layouts', () => {
    expect(cardSource).toContain('showTrackButton = true');

    const mobileBranch = cardSource.slice(
      cardSource.indexOf('{isMobile ? ('),
      cardSource.indexOf(') : (', cardSource.indexOf('{isMobile ? (')),
    );
    const desktopBranch = cardSource.slice(
      cardSource.indexOf(') : (', cardSource.indexOf('{isMobile ? (')),
      cardSource.indexOf('<Text\n        ref={titleRef}'),
    );

    expect(mobileBranch).toContain('<BillTrackButton');
    expect(desktopBranch).toContain('<BillTrackButton');
  });
});
