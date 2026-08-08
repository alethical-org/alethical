import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const api = readFileSync(join(SRC, 'data/api.ts'), 'utf8');
const hooks = readFileSync(join(SRC, 'hooks/useAppQueries.ts'), 'utf8');
const answer = readFileSync(join(SRC, 'screens/redesign/AskAnswerScreen.tsx'), 'utf8');
const summary = readFileSync(join(SRC, 'components/billDetail/SummaryTab.tsx'), 'utf8');
const mobile = readFileSync(join(SRC, 'screens/redesign/BillDetailScreen.tsx'), 'utf8');

describe('saved suggested Ask answers', () => {
  it('reads by public bill and suggestion identity without sending the question', () => {
    expect(api).toContain('`/ask/suggestions/${encodeURIComponent(billId)}/${suggestionIndex}`');
    expect(api).not.toContain(
      '`/ask/suggestions/${encodeURIComponent(billId)}/${suggestionIndex}?q=',
    );
  });

  it('warms only the safe GET and keeps POST as the click-time miss fallback', () => {
    expect(hooks).toContain('usePrefetchSuggestedAnswer');
    expect(hooks).toContain('getSavedSuggestedAnswerFromApi');
    expect(hooks).toContain('savedQuery.isSuccess && savedQuery.data === null');
  });

  it('skips the extra name, bill, vote, and bill-text reads for a self-contained hit', () => {
    expect(answer).toContain('enabled: !suggestionIdentity');
    expect(answer).toContain('includeVotes: false');
    expect(answer).toContain('answer?.answeringBillCard');
    expect(answer).toContain('citation.sectionAvailable == null');
  });

  it('puts safe identity on stored chips and warms it on pointer, keyboard, or touch intent', () => {
    for (const source of [summary, mobile, answer]) {
      expect(source).toContain('suggestionIndex');
      expect(source).toContain('onIntent');
    }
  });
});
