import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children, testID, ...props }: React.PropsWithChildren<{ testID?: string }>) => (
    <svg data-testid={testID} {...props}>
      {children}
    </svg>
  ),
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));

import { RepresentativeCard, VacantSeatCard } from '../RepresentativeCard';
import type { Legislator } from '../../../data/types';

const componentSource = readFileSync(join(__dirname, '..', 'RepresentativeCard.tsx'), 'utf8');

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

    expect(html).toContain('STATE SENATOR');
    expect(html).toContain('SENATE DISTRICT 27');
    expect(html).toContain('> · </div>');
    expect(html).toContain('PARTY');
    expect(html).toContain('Democratic-Farmer-Labor');
    expect(html).toContain('RESIDENCE');
    expect(html).toContain('Example City');
    expect(html).toContain('COMMITTEES');
    expect(html).not.toContain('COMMITTEES &amp; LEADERSHIP');
    expect(html).toContain('Finance, Chair');
    expect(html).toContain('156</span> bills authored · <span');
    expect(html).toContain('70</span> as chief author');
    expect(html).not.toContain('Including');
    expect(html).toContain('94TH LEGISLATURE (2025–26)');
    expect(html.indexOf('94TH LEGISLATURE (2025–26)')).toBeLessThan(
      html.indexOf('156</span> bills authored'),
    );
    expect(html).toContain('Elected to the Senate: 2020, re-elected 2024.');
    expect(html).toContain('Current chamber term: 2nd.');
    expect(html).not.toContain('ELECTION &amp; TERM');
  });

  it('makes an empty committee list explicit rather than silently dropping it', () => {
    const html = renderCard();

    expect(html).toContain('COMMITTEES');
    expect(html).toContain('None recorded');
  });

  it('orders phone, email, office, official profile, and the final Alethical action', () => {
    const html = renderCard({ legislator: detailedLegislator });

    expect(html).toContain('href="tel:+16515550100"');
    expect(html).toContain('href="mailto:sen.alex@example.mn"');
    expect(html).toContain('Official Senate profile');
    expect(html).not.toContain('Official Senate page');
    expect(html).not.toContain('↗');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html.match(/data-testid="link-arrow"/g)).toHaveLength(2);
    expect(html).not.toContain('→');

    const phone = html.indexOf('651-555-0100');
    const separator = html.indexOf('>·<', phone);
    const email = html.indexOf('sen.alex@example.mn');
    const office = html.indexOf('100 Example Building');
    const official = html.indexOf('Official Senate profile');
    const profile = html.indexOf('View profile');
    expect(phone).toBeLessThan(separator);
    expect(separator).toBeLessThan(email);
    expect(email).toBeLessThan(office);
    expect(office).toBeLessThan(official);
    expect(official).toBeLessThan(profile);
  });

  it('keeps the same View profile label on phone', () => {
    const html = renderCard({ mobile: true });

    expect(html).toContain('View profile');
    expect(html).not.toContain('View full profile');
    expect(html).toContain('data-testid="link-arrow"');
    expect(componentSource).toContain("import { LinkArrow } from '../LinkArrow'");
    expect(componentSource).not.toContain("{' →'}");
    expect(componentSource).not.toMatch(/>\s*→\s*</);
  });

  it('stacks the phone identity without leaving a separator on either line', () => {
    const html = renderCard({ legislator: detailedLegislator, mobile: true });

    expect(html).toContain('STATE SENATOR');
    expect(html).toContain('SENATE DISTRICT 27');
    expect(html).not.toContain('> · </div>');
    expect(componentSource).toMatch(
      /districtEyebrowMobile:\s*\{[^}]*flexDirection: 'column'[^}]*alignItems: 'flex-start'/,
    );
  });

  it('omits an unavailable public email and its separator', () => {
    const html = renderCard({
      legislator: { ...detailedLegislator, email: undefined },
    });

    expect(html).toContain('href="tel:+16515550100"');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('>·<');
  });

  it('caps committee assignments at 3', () => {
    const html = renderCard({
      legislator: {
        ...detailedLegislator,
        committeeAssignments: [
          { name: 'Committee 1', role: null },
          { name: 'Committee 2', role: null },
          { name: 'Committee 3', role: null },
          { name: 'Committee 4', role: null },
        ],
      },
    });

    expect(html).toContain('Committee 1');
    expect(html).toContain('Committee 3');
    expect(html).not.toContain('Committee 4');
  });

  it('carries the accepted desktop and phone type and action styles', () => {
    expect(componentSource).toMatch(
      /districtEyebrowText:\s*\{[\s\S]*fontSize: 12\.5[\s\S]*letterSpacing: 1\.5[\s\S]*color: t\.colors\.brand\.deep/,
    );
    expect(componentSource).toMatch(
      /districtEyebrowTextMobile:\s*\{[^}]*fontSize: 11[^}]*letterSpacing: 1\.32/,
    );
    expect(componentSource).toMatch(/districtEyebrowPart:\s*\{[^}]*whiteSpace: 'nowrap'/);
    expect(componentSource).toMatch(/authoredMobile:\s*\{[^}]*fontSize: 15/);
    expect(componentSource).toMatch(/authoredNumber:\s*\{[^}]*fontWeight: '800'/);
    expect(componentSource).toMatch(
      /legislatureMobile:\s*\{[^}]*fontSize: 10[^}]*letterSpacing: 0\.8/,
    );
    expect(componentSource).toMatch(/contactLinkMobile:\s*\{[^}]*fontSize: 13\.5/);
    expect(componentSource).toMatch(
      /profileButton:\s*\{[\s\S]*alignSelf: 'flex-start'[\s\S]*paddingHorizontal: 22[\s\S]*paddingVertical: 13/,
    );
    expect(componentSource).toMatch(/profileButtonMobile:\s*\{[^}]*width: '100%'/);
    expect(componentSource).toContain("backgroundColor: '#2c322c'");
    expect(componentSource).toContain("overflowWrap: 'anywhere'");
  });

  it('lets phone cards grow with their content and keeps the final action inside', () => {
    expect(componentSource).toMatch(
      /<View\s+style=\{\[styles\.card,[^\]]*mobile && styles\.cardMobile\]\}/,
    );
    expect(componentSource).toMatch(
      /<View\s+style=\{\[styles\.vacant, mobile && styles\.vacantMobile\]\}/,
    );
    expect(componentSource).toMatch(
      /cardMobile:\s*\{[^}]*flexGrow: 0[^}]*flexShrink: 0[^}]*flexBasis: 'auto'/,
    );
    expect(componentSource).toMatch(
      /vacantMobile:\s*\{[^}]*flexGrow: 0[^}]*flexShrink: 0[^}]*flexBasis: 'auto'/,
    );
    expect(componentSource).toMatch(
      /profileButtonMobile:\s*\{[^}]*width: '100%'[^}]*minHeight: 46[^}]*marginTop: 13/,
    );
  });

  it('aligns each desktop section with the matching section in the neighboring card', () => {
    expect(componentSource).toContain('alignSections = false');
    expect(componentSource).toContain("gridTemplateRows: 'subgrid'");
    expect(componentSource).toContain("gridRow: 'span 7'");
    expect(componentSource).toContain("justifySelf: 'start'");
    expect(componentSource.match(/alignedRowStyle\([1-7]\)/g)).toHaveLength(7);
  });

  it('keeps initials beneath a decorative image layer without an error handler', () => {
    expect(componentSource).toContain("position: 'absolute'");
    expect(componentSource).not.toContain('onError=');
    expect(componentSource).not.toContain('onError:');
  });

  it('gives a vacancy its district and deliberate empty-card treatment', () => {
    const html = renderToStaticMarkup(<VacantSeatCard districtLabel="HOUSE DISTRICT 21A" />);

    expect(html).toContain('HOUSE DISTRICT 21A');
    expect(html).toContain('Seat vacant');
    expect(html).toContain('No member currently holds this seat.');
  });
});
