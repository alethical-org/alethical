import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { useRead } from '../api/read';
import type { CountKey, ServedCounts } from '../landing/counts';
import { Link } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteName } from '../routes';
import { useSuggestionBox } from '../search/SuggestionBox';
import { useBand } from '../ui/band';
import { Arrow, SourcesAndUpdates, type SourceGroup } from '../ui/parts';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const HOME = hrefFor('home');

/** The 1 header-corner action (Finance Home, Round 30 of 2 Nov 2026): the
 * filled 48px button beside the eyebrow and title, dropping under the title
 * where they cannot share a line. Confirm identities and Check TV station
 * files are entered only from their context, and Donors by employer from
 * Campaign money (rule eug-44), never from here. */
const ACTION: { label: string; route: RouteName } = {
  label: 'Explore money connections',
  route: 'money-connections',
};

/** Entrances only: each opens an existing directory with its filter chosen. */
const ENTRANCES: ReadonlyArray<{
  label: string;
  route: RouteName;
  query?: Record<string, string>;
}> = [
  { label: 'Legislators', route: 'people', query: { type: 'legislators', service: 'current' } },
  { label: 'Candidates', route: 'people', query: { type: 'candidates' } },
  { label: 'Lobbyists', route: 'lobbying', query: { tab: 'lobbyists' } },
  { label: 'Committees and funds', route: 'campaign-money', query: { tab: 'committees' } },
  { label: 'Party units', route: 'campaign-money', query: { tab: 'party' } },
  { label: 'Vendors and payees', route: 'recipients' },
  { label: 'Lobbying organizations', route: 'lobbying', query: { tab: 'principals' } },
];

type Dates = Partial<Record<CountKey, string | null>>;

interface Family {
  title: string;
  route: RouteName;
  body: string;
  source: string;
  dated: (dates: Dates) => string;
}

function dated(what: string, verb: string, iso: string | null | undefined): string {
  return iso ? `${what} ${verb} ${centralDateLabel(iso)}` : what;
}

const TV_STATIONS = 'KSTP-TV, KARE and KMSP-TV';

/** The family cards, in the approved order (Media buys directly after Campaign
 * money, as in the header). */
const FAMILIES: readonly Family[] = [
  {
    title: 'Campaign money',
    route: 'campaign-money',
    body: 'Registered committees, funds and party units; their official report figures and itemized payments',
    source: BOARD,
    dated: (d) => dated('Payment files', 'copied', d.campaign_money_records),
  },
  {
    title: 'Media buys',
    route: 'media-buys',
    body: 'TV station files for political ad time: folders, agency names, stations and years',
    source: TV_STATIONS,
    dated: (d) => dated('TV station files', 'copied', d.tv_station_files),
  },
  {
    title: 'Lobbying',
    route: 'lobbying',
    body: 'Who is registered to lobby, who they represent, and what is reported spent',
    source: BOARD,
    // The lobbyist list's own copy date is read on the Lobbying page; the
    // landing counts carry the spending reports' date, a different dataset.
    dated: () => 'Lobbyist list',
  },
  {
    title: 'People',
    route: 'people',
    body: 'Candidate profiles, legislative service and links to related records',
    source: 'Minnesota Secretary of State',
    dated: () => 'Candidate records',
  },
  {
    title: 'Legislation',
    route: 'legislation',
    body: 'Bills, versions, actions, authors, committees and recorded roll calls',
    source: 'Minnesota Legislature',
    dated: (d) => dated('Bills', 'updated', d.current_legislature_bills),
  },
];

/** Sources and updates keep their own order, independent of the card order. */
const SOURCE_ORDER = [BOARD, 'Minnesota Secretary of State', 'Minnesota Legislature', TV_STATIONS];

function copyDates(counts: ServedCounts | null): Dates {
  const dates: Dates = {};
  if (!counts) return dates;
  for (const key of Object.keys(counts) as CountKey[]) {
    const count = counts[key];
    dates[key] = count && count.state === 'reported' ? count.copied_at : null;
  }
  return dates;
}

/** Research entry (Finance Home drawing): search with suggestions, entrances
 * into each directory, a card per record family, and their sources. */
export function FinanceHome() {
  const band = useBand();
  const isPhone = band === 'phone';
  const box = useSuggestionBox('home-sg', HOME);
  const counts = useRead<ServedCounts>('finance/landing/counts');
  const dates = copyDates(counts.data);

  const action = isBuilt(ACTION.route) ? ACTION : null;
  const entrances = ENTRANCES.filter((entrance) => isBuilt(entrance.route));
  const families = FAMILIES.filter((family) => isBuilt(family.route));
  const groups: SourceGroup[] = SOURCE_ORDER.map((source) => ({
    source,
    items: families
      .filter((family) => family.source === source)
      .map((family) => `${family.title} · ${family.dated(dates)}`),
  })).filter((group) => group.items.length > 0);

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        <section className="f-home-hero">
          <div className="f-page-head">
            <div>
              <div className="f-label">MINNESOTA</div>
              <h1 tabIndex={-1} className="f-home-title">
                Research public records
              </h1>
            </div>
            {action && (
              <Link to={withFrom(hrefFor(action.route), HOME)} className="f-btn f-action">
                <span>{action.label}</span>
                <Arrow stroke="#FFFFFF" />
              </Link>
            )}
          </div>
          <form role="search" onSubmit={box.submit} className="f-home-search">
            <label htmlFor="home-search" className="f-visually-hidden">
              Search records
            </label>
            <div ref={box.rootRef} className="f-home-field-wrap">
              <input
                {...box.inputProps}
                id="home-search"
                className="f-field f-home-field"
                placeholder={
                  isPhone ? 'Name or bill number' : 'Find a person, organization, committee or bill'
                }
              />
              {box.panel && <div className="f-home-sg">{box.panel}</div>}
            </div>
            <button type="submit" className="f-btn f-home-submit">
              Search
            </button>
          </form>
        </section>
        {entrances.length > 0 && (
          <section aria-labelledby="browse-h" className="f-home-browse">
            <h2 id="browse-h" className="f-card-title">
              Browse records
            </h2>
            {entrances.length > 0 && (
              <ul aria-labelledby="browse-h" className="f-home-entrances">
                {entrances.map((entrance) => (
                  <li key={entrance.label}>
                    <Link
                      to={withFrom(hrefFor(entrance.route, {}, entrance.query), HOME)}
                      className="f-home-entrance"
                    >
                      <span>{entrance.label}</span>
                      <Arrow />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {families.length > 0 && (
          <section aria-label="Record families" className="f-home-families">
            {families.map((family) => (
              <Link key={family.title} to={hrefFor(family.route)} className="f-home-family">
                <span className="f-home-family-title">{family.title}</span>
                <p>{family.body}</p>
                <span className="f-home-family-arrow">
                  <Arrow />
                </span>
              </Link>
            ))}
          </section>
        )}
      </div>
      <SourcesAndUpdates groups={groups} />
    </main>
  );
}
