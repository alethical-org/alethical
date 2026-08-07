import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

import { RepresentativeCard, VacantSeatCard } from '../RepresentativeCard';
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

function renderCard({
  issueAreas,
  mobile = false,
  legislatureLabel,
  legislator = baseLegislator,
}: {
  issueAreas?: string[];
  mobile?: boolean;
  legislatureLabel?: string;
  legislator?: Legislator;
} = {}) {
  return renderToStaticMarkup(
    <RepresentativeCard
      legislator={{ ...legislator, issueAreas }}
      legislatureLabel={legislatureLabel}
      mobile={mobile}
      onProfile={vi.fn()}
    />,
  );
}

describe('RepresentativeCard issue labels', () => {
  it('omits the whole issue block when no labels are available', () => {
    const html = renderCard();

    expect(html).not.toContain('ISSUES ON BILLS AUTHORED');
  });

  it('shows all 6 supplied labels without a remainder', () => {
    const issues = ['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4', 'Issue 5', 'Issue 6'];
    const html = renderCard({ issueAreas: issues });

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
    const html = renderCard({ issueAreas: issues });

    for (const issue of issues.slice(0, 6)) expect(html).toContain(issue);
    for (const issue of issues.slice(6)) expect(html).not.toContain(issue);
    expect(html).toContain('+4 more');
  });

  it('never displays more than 6 chips or a larger-than-20 remainder', () => {
    const issues = Array.from({ length: 30 }, (_, index) => `Issue ${index + 1}`);
    const html = renderCard({ issueAreas: issues });

    for (const issue of issues.slice(0, 6)) expect(html).toContain(issue);
    expect(html).not.toContain('Issue 7');
    expect(html).toContain('+20 more');
    expect(html).not.toContain('+24 more');
  });
});

describe('RepresentativeCard accepted layout', () => {
  const detailedLegislator: Legislator = {
    ...baseLegislator,
    chamber: 'Senate',
    district: '27',
    party: 'DFL',
    representedCity: 'Example City',
    committeeAssignments: [{ name: 'Finance', role: 'Chair' }],
    totalAuthoredBills: 156,
    chiefAuthoredBills: 70,
    legislativeService: {
      lines: [
        { chamber: 'Senate', label: 'Elected to the Senate', elected: '2020, re-elected 2024' },
      ],
      term: '2nd',
    },
    email: 'sen.alex@example.mn',
    phone: '651-555-0100',
    officeAddress: '100 Example Building',
    profileUrl: 'https://www.senate.mn/members/member_bio.html?leg_id=1',
  };

  it('uses the labelled, full-party card facts and concise record copy', () => {
    const html = renderCard({
      legislator: detailedLegislator,
      legislatureLabel: '94TH LEGISLATURE (2025–26)',
    });

    expect(html).toContain('STATE SENATOR · SENATE DISTRICT 27');
    expect(html).toContain('PARTY');
    expect(html).toContain('Democratic-Farmer-Labor');
    expect(html).toContain('RESIDENCE');
    expect(html).toContain('Example City');
    expect(html).toContain('COMMITTEES');
    expect(html).not.toContain('COMMITTEES &amp; LEADERSHIP');
    expect(html).toContain('Finance, Chair');
    expect(html).toContain('156 bills authored');
    expect(html).toContain('Including 70 as chief author');
    expect(html).toContain('94TH LEGISLATURE (2025–26)');
    expect(html).toContain('Elected to the Senate: 2020, re-elected 2024.');
    expect(html).toContain('Current chamber term: 2nd.');
    expect(html).not.toContain('ELECTION &amp; TERM');
  });

  it('makes an empty committee list explicit rather than silently dropping it', () => {
    const html = renderCard();

    expect(html).toContain('COMMITTEES');
    expect(html).toContain('None recorded');
  });

  it('keeps contacts together and makes the internal profile action primary', () => {
    const html = renderCard({ legislator: detailedLegislator });

    expect(html).toContain('sen.alex@example.mn');
    expect(html).toContain('651-555-0100');
    expect(html).toContain('100 Example Building');
    expect(html).toContain('Official Senate page');
    expect(html).toContain('↗');
    expect(html).toContain('View profile');
    expect(html).toContain('→');
  });

  it('uses the phone-specific profile label', () => {
    expect(renderCard({ mobile: true })).toContain('View full profile');
  });

  it('keeps initials beneath a decorative image layer without an error handler', () => {
    const source = readFileSync(join(__dirname, '..', 'RepresentativeCard.tsx'), 'utf8');

    expect(source).toContain("position: 'absolute'");
    expect(source).not.toContain('onError=');
    expect(source).not.toContain('onError:');
  });

  it('gives a vacancy its district and deliberate empty-card treatment', () => {
    const html = renderToStaticMarkup(<VacantSeatCard districtLabel="HOUSE DISTRICT 21A" />);

    expect(html).toContain('HOUSE DISTRICT 21A');
    expect(html).toContain('Seat vacant');
    expect(html).toContain('No member currently holds this seat.');
  });
});
