import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, path), 'utf8');

const sharedCard = source('../../components/search/BillResultCard.tsx');
const home = source('../../screens/redesign/HomeSignedOutScreen.tsx');
const search = source('../../screens/redesign/SearchBillsScreen.tsx');
const answers = source('../../screens/redesign/AskAnswerScreen.tsx');
const tracked = source('../../screens/redesign/TrackedBillsScreen.tsx');
const legislatorWeb = source('../../screens/redesign/LegislatorProfileWebScreen.tsx');
const legislatorMobile = source('../../screens/redesign/LegislatorProfileMobileScreen.tsx');

describe('controls inside bill-card links', () => {
  it('uses the shared card on Home, Search, both answer layouts, and Tracked bills', () => {
    for (const screen of [home, search, answers, tracked]) {
      expect(screen).toContain('<BillResultCard');
      expect(screen).toContain('onToggleTrack=');
    }
    expect(answers.match(/<BillResultCard/g)).toHaveLength(2);
  });

  it('puts card content and real controls above the full-card link', () => {
    expect(sharedCard).toContain('...CARD_LINK_LAYER');
    expect(sharedCard).toContain('CARD_CONTENT_LAYER');
    expect(sharedCard).toContain('interactiveLayer: CARD_CONTROL_LAYER');
    expect(sharedCard).toContain('<BillTrackButton');
    expect(sharedCard).toContain('<VoteCountLinkChip');
    expect(sharedCard).toContain('<ChiefAuthorLink');
  });

  it('gives legislator bill cards the same Track control and layers', () => {
    for (const profile of [legislatorWeb, legislatorMobile]) {
      expect(profile).toContain('<BillTrackButton');
      expect(profile).toContain('...CARD_LINK_LAYER');
      expect(profile).toContain('CARD_CONTENT_LAYER');
      expect(profile).toContain('billCardControl: CARD_CONTROL_LAYER');
    }
  });
});
