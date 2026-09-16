import type { PageSnapshot, SnapshotSection } from './pageSnapshot';
import type {
  LobbyingSummary,
  LobbyingPrincipalsPage,
  LobbyingLobbyistsPage,
  LobbyingPrincipal,
  LobbyingLobbyist,
} from './lobbyingTypes';
import {
  LOBBYING_DIRECTORY_COPY as directory,
  lobbyingShowingLine,
  lobbyingNoSpendingRows,
  lobbyingPrincipalCount,
  lobbyingLatestYear,
  lobbyingHeldYearsNote,
  lobbyistLaneCount,
  principalLaneCount,
} from './lobbyingDirectoryCopy';
import {
  lobbyingPrincipalCopy as principalCopy,
  lobbyingLobbyistCopy as lobbyistCopy,
  principalSpellingLines,
  recordCountLine,
  spendingRowIsBlank,
  spendingRowHasFullKinds,
  PRINCIPAL_SOURCE_URL,
  LOBBYIST_SOURCE_URL,
  LOBBYIST_DONATIONS_UNAVAILABLE,
  PRINCIPAL_LOBBYISTS_UNAVAILABLE,
  PRINCIPAL_SPENDING_UNAVAILABLE,
  LOBBYIST_PRINCIPALS_UNAVAILABLE,
  CAMPAIGN_CONTRIBUTION_SOURCE_LABEL,
  campaignContributionCopiedLine,
  visibleLobbyingDonationYears,
} from './lobbyingRecordCopy';
import { centralDateLabel } from './moneyLanding';
import { committeeSlug, registerKindLabel } from './committeeMoneyShared';
import { formatDay, formatMoney } from './legislatorCampaignMoney';
import { directoryPagePath, directoryTotalPages } from './directoryPagination';

const recordPath = (kind: 'principals' | 'lobbyists', name: string, id: string | number) =>
  `/money/lobbying/${kind}/${encodeURIComponent(committeeSlug(name, String(id)))}`;
const copied = (date: string | null) =>
  date ? `Board files copied ${centralDateLabel(date)}` : '';
const amount = (value: string | null) => formatMoney(value) ?? 'Not reported';
const base = (heading: string, subheading = ''): PageSnapshot => ({
  heading,
  subheading,
  bodyHeading: '',
  body: [],
  bodyIsList: false,
  facts: [],
  links: [{ label: directory.title, href: '/money/lobbying' }],
});

export function lobbyingLandingSnapshot(data: LobbyingSummary): PageSnapshot {
  return {
    ...base(directory.title, directory.landingLabel),
    body: [directory.intro],
    records: [
      {
        label: directory.lobbyists.title,
        href: '/money/lobbying/lobbyists',
        detail: [directory.lobbyists.intro, lobbyistLaneCount(data.registered_lobbyists)]
          .filter(Boolean)
          .join(' · '),
      },
      {
        label: directory.principals.title,
        href: '/money/lobbying/principals',
        detail: [
          directory.principals.lane,
          principalLaneCount(data.principals_reporting, data.latest_reported_year),
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ],
    sections: [
      {
        heading: directory.copiedLabel,
        body: [data.copied_at ? centralDateLabel(data.copied_at) : '', directory.copiedNote].filter(
          Boolean,
        ),
      },
      {
        heading: directory.coverageLabel,
        body: [
          directory.currentOnly,
          directory.annual,
          lobbyingHeldYearsNote(data.first_year),
          directory.coverageCloser,
        ].filter((line): line is string => Boolean(line)),
        bodyIsList: true,
      },
    ],
  };
}

export function lobbyingDirectorySnapshot(
  data: LobbyingPrincipalsPage | LobbyingLobbyistsPage,
  kind: 'principals' | 'lobbyists',
  page: number,
): PageSnapshot {
  const rows = 'principals' in data ? data.principals : data.lobbyists;
  const total = data.total ?? 0;
  const pages = directoryTotalPages(total, 50);
  const path = `/money/lobbying/${kind}` as const;
  return {
    ...base(directory[kind].title, directory.directoryLabel),
    body: [
      directory[kind].intro,
      lobbyingShowingLine(kind, page, rows.length, total),
      ...(rows.length ? [] : [directory[kind].empty, directory.noMatchWhy]),
    ].filter(Boolean),
    sections: [
      {
        heading: '',
        items: rows.map((row) => {
          if ('registration_number' in row)
            return {
              label: row.name,
              detail: lobbyingPrincipalCount(row.principal_count),
              href: recordPath('lobbyists', row.name, row.registration_number),
            };
          return {
            label: row.name,
            detail: row.linkable
              ? (lobbyingLatestYear(row.latest_reported_year) ?? undefined)
              : lobbyingNoSpendingRows(
                  'latest_reported_year' in data ? data.latest_reported_year : null,
                ),
            ...(row.linkable ? { href: recordPath('principals', row.name, row.entity_id) } : {}),
          };
        }),
      },
    ],
    links: [
      ...(page > 1 ? [{ label: 'Previous', href: directoryPagePath(path, page - 1) }] : []),
      ...(page < pages ? [{ label: 'Next', href: directoryPagePath(path, page + 1) }] : []),
      { label: directory.title, href: '/money/lobbying' },
    ],
  };
}

export function lobbyingPrincipalSnapshot(data: LobbyingPrincipal): PageSnapshot {
  const rows = data.lobbyists.rows.slice(0, 30);
  const spending: SnapshotSection = {
    heading: principalCopy.spendingHeading,
    blocks: [
      { kind: 'prose', lines: [principalCopy.spendingIntroduction] },
      {
        kind: 'table',
        caption: principalCopy.spendingCaption,
        rowHeaders: true,
        columns: [
          'Year',
          'Total spent',
          'PUC',
          'General',
          'Legislative',
          'Administrative',
          'Metropolitan',
        ],
        rows: data.spending.rows.map((row) =>
          spendingRowIsBlank(row)
            ? [String(row.year ?? 'Not reported'), { text: 'Not reported', colSpan: 6 }]
            : [
                String(row.year ?? 'Not reported'),
                amount(row.total_spent),
                amount(row.puc_lobbying_amount),
                amount(row.general_lobbying_amount),
                ...(spendingRowHasFullKinds(row)
                  ? [
                      amount(row.legislative_lobbying_amount),
                      amount(row.administrative_lobbying_amount),
                      amount(row.mgu_lobbying_amount),
                    ]
                  : [{ text: principalCopy.oldKindsWide, colSpan: 3 }]),
              ],
        ),
      },
      { kind: 'prose', lines: [principalCopy.kindsNote] },
    ],
  };
  if (data.spending.state !== 'reported' || data.spending.rows.length === 0) {
    spending.blocks = [
      {
        kind: 'prose',
        lines: [
          principalCopy.spendingIntroduction,
          data.spending.state === 'unavailable'
            ? PRINCIPAL_SPENDING_UNAVAILABLE
            : lobbyingNoSpendingRows(data.source_latest_year),
        ],
      },
    ];
  }
  return {
    ...base(data.name ?? `Entity ${data.entity_id}`, `PRINCIPAL · ENTITY ${data.entity_id}`),
    body: [
      principalCopy.gloss,
      ...principalSpellingLines(data.lobbyists.rows),
      copied(data.copied_at),
    ].filter(Boolean),
    sections: [
      spending,
      {
        heading: principalCopy.lobbyistsHeading,
        body: [
          principalCopy.lobbyistsIntroduction,
          ...(data.lobbyists.state === 'reported' &&
          data.lobbyists.total != null &&
          data.lobbyists.total > 0
            ? [recordCountLine(data.lobbyists.total, rows.length, 'lobbyist', 'lobbyists')]
            : []),
          ...(data.lobbyists.state === 'unavailable'
            ? [PRINCIPAL_LOBBYISTS_UNAVAILABLE]
            : rows.length
              ? []
              : [principalCopy.noLobbyists]),
        ],
        items: rows.map((row) => ({
          label: row.name,
          href: recordPath('lobbyists', row.name, row.registration_number),
        })),
      },
    ],
    links: [
      { label: principalCopy.sourceLabel, href: PRINCIPAL_SOURCE_URL },
      { label: directory.principals.title, href: '/money/lobbying/principals' },
    ],
  };
}

export function lobbyingLobbyistSnapshot(data: LobbyingLobbyist): PageSnapshot {
  const rows = data.principals.rows.slice(0, 30);
  const visibleYears =
    data.contributions.state === 'reported'
      ? visibleLobbyingDonationYears(data.contributions.years, 30)
      : [];
  const shownPayments = visibleYears.reduce(
    (n, year) =>
      n + year.committees.reduce((count, committee) => count + committee.payments.length, 0),
    0,
  );
  const donationDate = campaignContributionCopiedLine(
    data.contributions.copied_at,
    centralDateLabel,
  );
  const donations: SnapshotSection[] = visibleYears.map((year) => ({
    heading: String(year.year ?? 'Not reported'),
    blocks: year.committees.flatMap((committee) => [
      {
        kind: 'links' as const,
        items: [
          {
            label: committee.name ?? `Registration ${committee.registration_number}`,
            detail: [
              registerKindLabel(committee.kind),
              committee.registration_number
                ? `Registration ${committee.registration_number}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            ...(committee.linkable && committee.registration_number
              ? {
                  href: `/money/committees/${committeeSlug(committee.name ?? '', committee.registration_number)}`,
                }
              : {}),
          },
        ],
      },
      {
        kind: 'bullets' as const,
        items: committee.payments.map((payment) =>
          [
            formatDay(payment.received_on) ?? 'Date not reported',
            payment.contributor_name && payment.contributor_name !== data.name
              ? `Filed as ${payment.contributor_name}`
              : null,
            payment.in_kind === 'Yes'
              ? ['DONATED GOODS OR SERVICES', payment.in_kind_description]
                  .filter(Boolean)
                  .join(' · ')
              : null,
            amount(payment.amount),
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      },
    ]),
  }));
  return {
    ...base(
      data.name ?? `Registration ${data.registration_number}`,
      `LOBBYIST · REGISTRATION ${data.registration_number}`,
    ),
    body: [copied(data.copied_at)].filter(Boolean),
    sections: [
      {
        heading: lobbyistCopy.principalsHeading,
        body: [
          lobbyistCopy.principalsIntroduction,
          ...(data.principals.state === 'reported' &&
          data.principals.total != null &&
          data.principals.total > 0
            ? [recordCountLine(data.principals.total, rows.length, 'principal', 'principals')]
            : []),
          ...(data.principals.state === 'unavailable' ? [LOBBYIST_PRINCIPALS_UNAVAILABLE] : []),
          ...(data.principals.state === 'reported' && data.principals.total === 0
            ? [lobbyistCopy.noPrincipals]
            : []),
          ...(data.state === 'not_registered_today'
            ? [`Registration ${data.registration_number} · not registered today`]
            : []),
        ],
        items: rows.map((row) => ({
          label: row.name,
          ...(row.linkable
            ? { href: recordPath('principals', row.spending_name ?? row.name, row.entity_id) }
            : { detail: lobbyingNoSpendingRows(data.latest_reported_year ?? null) }),
        })),
      },
      {
        heading: lobbyistCopy.donationsHeading,
        body: [
          lobbyistCopy.donationsIntroduction,
          ...(donationDate ? [donationDate] : []),
          ...(data.contributions.state === 'reported' && data.contributions.payment_count != null
            ? [
                recordCountLine(
                  data.contributions.payment_count,
                  shownPayments,
                  'donation',
                  'donations',
                ),
              ]
            : []),
          ...(data.contributions.state === 'not_reported'
            ? [lobbyistCopy.noDonations]
            : data.contributions.state === 'unavailable'
              ? [LOBBYIST_DONATIONS_UNAVAILABLE]
              : []),
        ],
      },
      ...donations,
    ],
    links: [
      ...(data.contributions.source_url
        ? [{ label: CAMPAIGN_CONTRIBUTION_SOURCE_LABEL, href: data.contributions.source_url }]
        : []),
      { label: lobbyistCopy.sourceLabel, href: LOBBYIST_SOURCE_URL },
      { label: directory.lobbyists.title, href: '/money/lobbying/lobbyists' },
    ],
  };
}
