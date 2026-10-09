import { MONEY_SECTION_NAME } from './moneySectionName';
import { SERVICES_SUBTITLE } from './servicesMetadata';
import { READ_PAGE_HEADING, READ_PAGE_INTRO, READ_PAGE_NAME } from './blogPageCopy';
import {
  committeeListPageMetadata,
  moneyByRacePageMetadata,
  pageMetadata,
  titleFor,
  type PageMetadata,
} from './share';

/** Pages whose wording never varies. */
export const STATIC_PAGE_METADATA: Record<string, PageMetadata> = {
  // The campaign money landing (public, no sign-in gate). The description may
  // say these records are searchable now that the field on it works and the
  // committees list exists (issue #1696) — until they shipped it deliberately
  // promised only the record (grounded-answers.md rule 2).
  '/money': pageMetadata({
    title: titleFor(`${MONEY_SECTION_NAME} in Minnesota`),
    socialTitle: MONEY_SECTION_NAME,
    description:
      'Campaign money records for Minnesota state campaigns, as the state publishes them, searchable by the name each record was filed under.',
    canonicalPath: '/money',
  }),
  '/money/committees': committeeListPageMetadata(),
  '/money/races': moneyByRacePageMetadata(),
  // The tab carries the page's own name, because the page itself shows no title:
  // the bar and the address already say the word, so a third visible instance is
  // what the naming rule forbids, and the tab is where the name still has to
  // exist (Design's /blog handoff, 27 Aug 2026). The share card keeps the
  // descriptive title instead, because a card has no bar or address beside it to
  // say what "Read" would mean.
  '/blog': pageMetadata({
    title: titleFor(READ_PAGE_NAME),
    socialTitle: READ_PAGE_HEADING,
    description: READ_PAGE_INTRO,
    canonicalPath: '/blog',
  }),
  '/email-preferences': pageMetadata({
    title: titleFor('Email preferences'),
    socialTitle: 'Email preferences',
    description: 'Choose which research and feature emails reach your account address.',
    canonicalPath: '/email-preferences',
    noindex: true,
  }),
  '/comment-emails': pageMetadata({
    title: titleFor('Comment emails'),
    socialTitle: 'Comment emails',
    description: 'Choose which comment emails to stop.',
    canonicalPath: '/comment-emails',
    noindex: true,
  }),
  '/unsubscribe': pageMetadata({
    title: titleFor('Unsubscribe'),
    socialTitle: 'Unsubscribe',
    description: 'Choose which research and feature emails to stop.',
    canonicalPath: '/unsubscribe',
    noindex: true,
  }),
  '/confirm': pageMetadata({
    title: titleFor('Confirm email'),
    socialTitle: 'Confirm email',
    description: 'Confirm the email address from this message.',
    canonicalPath: '/confirm',
    noindex: true,
  }),
  '/reset': pageMetadata({
    title: titleFor('Reset password'),
    socialTitle: 'Reset password',
    description: 'Check this reset link and choose a new password.',
    canonicalPath: '/reset',
    noindex: true,
  }),
  '/candidates': pageMetadata({
    title: titleFor('Find My Candidates'),
    socialTitle: 'Find My Candidates',
    description:
      'Enter a Minnesota street address to see source-backed candidates for state and local offices.',
    canonicalPath: '/candidates',
  }),
  // Every feature on this page is on the roadmap; it stays out of search results
  // until a feature it describes is available.
  '/candidates/features': pageMetadata({
    title: titleFor('Candidate profile features'),
    socialTitle: 'Candidate profile features',
    description:
      'What a claimed candidate profile will offer campaigns and voters. Every feature listed is on the roadmap.',
    canonicalPath: '/candidates/features',
    noindex: true,
  }),
  '/find-my-legislator': pageMetadata({
    title: titleFor('Find my legislator'),
    socialTitle: 'Find my legislator',
    description:
      'Enter a Minnesota address to see which state House and Senate members represent it.',
    canonicalPath: '/find-my-legislator',
  }),
  '/about': pageMetadata({
    title: titleFor('About us'),
    socialTitle: 'About us',
    description:
      'Why this site exists, and how Minnesota’s official legislative record is turned into plain language.',
    canonicalPath: '/about',
  }),
  '/services': pageMetadata({
    title: titleFor('Political intelligence and campaign services'),
    socialTitle: 'Political intelligence and campaign services',
    description: SERVICES_SUBTITLE,
    canonicalPath: '/services',
  }),
  '/about/contact': pageMetadata({
    title: titleFor('Contact us'),
    socialTitle: 'Contact us',
    description: 'Send a question, a correction, or feedback about Minnesota legislative records.',
    canonicalPath: '/about/contact',
  }),
  '/privacy': pageMetadata({
    title: titleFor('Privacy Policy'),
    socialTitle: 'Privacy Policy',
    description: 'How information is collected, used, and protected on this site.',
    canonicalPath: '/privacy',
  }),
  '/admin/site-metrics': pageMetadata({
    title: titleFor('Site Metrics'),
    socialTitle: 'Site Metrics',
    description: 'Private totals about traffic, search discovery, availability, and speed.',
    canonicalPath: '/admin/site-metrics',
    noindex: true,
  }),
  '/terms': pageMetadata({
    title: titleFor('Terms of Service'),
    socialTitle: 'Terms of Service',
    description: 'The terms that govern use of this website and application.',
    canonicalPath: '/terms',
  }),
  // Signed-in surface: a search engine would only ever see the signed-out card,
  // so it is left out of the sitemap and unlisted.
  '/admin/operations': pageMetadata({
    title: titleFor('Admin metrics'),
    socialTitle: 'Admin metrics',
    description: 'Private aggregate measurements for approved administrators.',
    canonicalPath: '/admin/operations',
    noindex: true,
  }),
  '/admin/candidate-claims': pageMetadata({
    title: titleFor('Profile claim requests'),
    socialTitle: 'Profile claim requests',
    description: 'Private candidate profile claim requests and statement reports.',
    canonicalPath: '/admin/candidate-claims',
    noindex: true,
  }),
  '/admin/users': pageMetadata({
    title: titleFor('Users'),
    socialTitle: 'Users',
    description: 'Private account information for approved administrators.',
    canonicalPath: '/admin/users',
    noindex: true,
  }),
  '/tracked': pageMetadata({
    title: titleFor('Tracked'),
    socialTitle: 'Tracked',
    description: 'The Minnesota bills and campaign committees you have chosen to follow.',
    canonicalPath: '/tracked',
    noindex: true,
  }),
};
