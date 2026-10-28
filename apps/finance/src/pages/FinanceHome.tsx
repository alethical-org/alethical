import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { useRead } from '../api/read';
import type { CountKey, ServedCounts } from '../landing/counts';
import { Link } from '../router';
import { withFrom } from '../returnContext';
import { isBuilt, type RouteName } from '../routes';
import { useSuggestionBox } from '../search/SuggestionBox';
import { useBand } from '../ui/band';
import { Arrow, SourcesAndUpdates, type SourceGroup } from '../ui/parts';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const HOME = '/home';

/** The 3 primary entrances beside the "Browse records" heading. */
const ACTIONS: ReadonlyArray<{ label: string; to: string; route: RouteName }> = [
  { label: 'Explore money connections', to: '/money/connections', route: 'money-connections' },
  { label: 'Confirm identities', to: '/money/identities', route: 'identities' },
  { label: 'Donors by employer, as printed', to: '/money/employers', route: 'employers' },
];

/** Entrances only: each opens an existing directory with its filter chosen. */
const ENTRANCES: ReadonlyArray<{ label: string; to: string; route: RouteName }> = [
  { label: 'Legislators', to: '/people?type=legislators&service=current', route: 'people' },
  { label: 'Candidates', to: '/people?type=candidates', route: 'people' },
  { label: 'Lobbyists', to: '/lobbying?tab=lobbyists', route: 'lobbying' },
  { label: 'Committees and funds', to: '/money?tab=committees', route: 'campaign-money' },
  { label: 'Party units', to: '/money?tab=party', route: 'campaign-money' },
  { label: 'Vendors and payees', to: '/money/recipients', route: 'recipients' },
  { label: 'Lobbying organizations', to: '/lobbying?tab=principals', route: 'lobbying' },
];

type Dates = Partial<Record<CountKey, string | null>>;

interface Family {
  title: string;
  to: string;
  route: RouteName;
  body: string;
  source: string;
  dated: (dates: Dates) => string;
}

function dated(what: string, verb: string, iso: string | null | undefined): string {
  return iso ? `${what} ${verb} ${centralDateLabel(iso)}` : what;
}

const FAMILIES: readonly Family[] = [
  {
    title: 'Campaign money',
    to: '/money',
    route: 'campaign-money',
    body: 'Registered committees, funds and party units; their official report figures and itemized payments',
    source: BOARD,
    dated: (d) => dated('Payment files', 'copied', d.campaign_money_records),
  },
  {
    title: 'Lobbying',
    to: '/lobbying',
    route: 'lobbying',
    body: 'Who is registered to lobby, who they represent, and what is reported spent',
    source: BOARD,
    // The lobbyist list's own copy date is read on the Lobbying page; the
    // landing counts carry the spending reports' date, a different dataset.
    dated: () => 'Lobbyist list',
  },
  {
    title: 'People',
    to: '/people',
    route: 'people',
    body: 'Candidate profiles, legislative service and links to related records',
    source: 'Minnesota Secretary of State',
    dated: () => 'Candidate records',
  },
  {
    title: 'Legislation',
    to: '/bills',
    route: 'legislation',
    body: 'Bills, versions, actions, authors, committees and recorded roll calls',
    source: 'Minnesota Legislature',
    dated: (d) => dated('Bills', 'updated', d.current_legislature_bills),
  },
  {
    title: 'Media buys',
    to: '/media-buys',
    route: 'media-buys',
    body: 'TV station files for political ad time: folders, agency names, stations and years',
    source: 'KSTP-TV, KARE and KMSP-TV',
    dated: (d) => dated('Station files', 'copied', d.tv_station_files),
  },
];

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
  const counts = useRead<ServedCounts>('/finance/landing/counts');
  const dates = copyDates(counts.data);

  const actions = ACTIONS.filter((action) => isBuilt(action.route));
  const entrances = ENTRANCES.filter((entrance) => isBuilt(entrance.route));
  const families = FAMILIES.filter((family) => isBuilt(family.route));
  const groups = families.reduce<SourceGroup[]>((all, family) => {
    const line = `${family.title} · ${family.dated(dates)}`;
    const group = all.find((item) => item.source === family.source);
    if (group) group.items.push(line);
    else all.push({ source: family.source, items: [line] });
    return all;
  }, []);

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        <section className="f-home-hero">
          <div className="f-label">MINNESOTA</div>
          <h1 tabIndex={-1} className="f-home-title">
            Research public records
          </h1>
          <form role="search" onSubmit={box.submit} className="f-home-search">
            <label htmlFor="home-search" className="f-visually-hidden">
              Search records
            </label>
            <div ref={box.rootRef} className="f-home-field-wrap">
              <input
                {...box.inputProps}
                id="home-search"
                className="f-field f-home-field"
                placeholder={isPhone ? 'Name or bill number' : 'Find a person, organization, committee or bill'}
              />
              {box.panel && <div className="f-home-sg">{box.panel}</div>}
            </div>
            <button type="submit" className="f-btn f-home-submit">
              Search
            </button>
          </form>
        </section>
        {(actions.length > 0 || entrances.length > 0) && (
          <section aria-labelledby="browse-h" className="f-home-browse">
            <div className="f-home-browse-head">
              <h2 id="browse-h" className="f-card-title">
                Browse records
              </h2>
              {actions.length > 0 && (
                <div className="f-home-actions">
                  {actions.map((action) => (
                    <Link key={action.to} to={withFrom(action.to, HOME)} className="f-btn f-action">
                      <span>{action.label}</span>
                      <Arrow stroke="#FFFFFF" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {entrances.length > 0 && (
              <ul aria-labelledby="browse-h" className="f-home-entrances">
                {entrances.map((entrance) => (
                  <li key={entrance.label}>
                    <Link to={withFrom(entrance.to, HOME)} className="f-home-entrance">
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
              <Link key={family.title} to={family.to} className="f-home-family">
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
