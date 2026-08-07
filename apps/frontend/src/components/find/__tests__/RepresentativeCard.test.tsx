import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

import { RepresentativeCard } from '../RepresentativeCard';
import type { Legislator } from '../../../data/types';

const baseLegislator: Legislator = {
  id: 'legislator-1',
  slug: 'alex-representative',
  name: 'Alex Representative',
  shortName: 'Alex Representative',
  chamber: 'House',
  district: '1A',
  party: 'DFL',
  role: 'Representative',
  committees: [],
  focusAreas: [],
  serviceHistory: [],
  questionPrompts: [],
  sponsoredBillIds: [],
  voteEventRefs: [],
};

function renderCard(issueAreas?: string[]) {
  return renderToStaticMarkup(
    <RepresentativeCard legislator={{ ...baseLegislator, issueAreas }} onProfile={vi.fn()} />,
  );
}

describe('RepresentativeCard issue labels', () => {
  it('omits the whole issue block when no labels are available', () => {
    const html = renderCard();

    expect(html).not.toContain('ISSUES ON BILLS AUTHORED');
  });

  it('shows all 6 supplied labels without a remainder', () => {
    const issues = ['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4', 'Issue 5', 'Issue 6'];
    const html = renderCard(issues);

    expect(html).toContain('ISSUES ON BILLS AUTHORED');
    for (const issue of issues) expect(html).toContain(issue);
    expect(html).not.toContain('more');
  });

  it('keeps the server order for the first 6 labels and discloses the remainder', () => {
    const issues = [
      'Issue 1',
      'Issue 2',
      'Issue 3',
      'Issue 4',
      'Issue 5',
      'Issue 6',
      'Issue 7',
      'Issue 8',
      'Issue 9',
      'Issue 10',
    ];
    const html = renderCard(issues);

    for (const issue of issues.slice(0, 6)) expect(html).toContain(issue);
    for (const issue of issues.slice(6)) expect(html).not.toContain(issue);
    expect(html).toContain('+4 more');
  });
});
