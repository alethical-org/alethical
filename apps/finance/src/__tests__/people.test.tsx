import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  candidateSeat,
  countLine,
  People,
  rowNote,
  type PersonDirectoryRow,
} from '../pages/People';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

function legislator(index: number) {
  const n = String(index).padStart(2, '0');
  return {
    id: `id-${n}`,
    slug: `member-${n}`,
    kind: 'legislator' as const,
    name: `Member ${n}`,
    service_status: 'current' as const,
    periods: [
      {
        chamber: index % 2 ? 'senate' : 'house',
        district: `${index}A`,
        party: null,
        start_date: null,
        end_date: null,
        session: null,
        source_url: null,
      },
    ],
  };
}

const ROWS = Array.from({ length: 23 }, (_, index) => legislator(index + 1));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requests = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(path: string, answer: (url: string) => Response | Promise<Response>) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      return answer(input);
    }),
  );
  await act(async () => {
    root.render(<People match={matchRoute('/people')!} />);
  });
  await settle();
}

const loaded = (url: string) => {
  const params = new URL(url).searchParams;
  const q = params.get('q') ?? '';
  const offset = Number(params.get('offset') ?? 0);
  const filtered = ROWS.filter((row) => row.name.includes(q));
  return json({
    state: 'reported',
    version: 'aaaaaaaaaaaaaaaa',
    rows: filtered.slice(offset, offset + 10),
    total: filtered.length,
    counts: { person: 0, candidate: 0, legislator: filtered.length },
    years: [2026, 2024],
    limit: 10,
    offset,
    has_more: offset + 10 < filtered.length,
    type: params.get('type'),
    q,
  });
};

const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('People', () => {
  it('prints confirmed source-record counts including zero without inventing a missing count', async () => {
    await render('/people', async (url) => {
      const body = await loaded(url).json();
      return json({
        ...body.data,
        rows: [
          { kind: 'person', id: 'one', name: 'One source', confirmed_record_count: 1 },
          { kind: 'person', id: 'several', name: 'Several sources', confirmed_record_count: 4 },
          { kind: 'person', id: 'zero', name: 'No source links', confirmed_record_count: 0 },
          { kind: 'person', id: 'older', name: 'Older reply' },
        ],
      });
    });
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('.pp-row')];
    expect(rows[0].textContent).toContain('1 confirmed record');
    expect(rows[1].textContent).toContain('4 confirmed records');
    expect(rows[2].textContent).toContain('0 confirmed records');
    expect(rows[3].textContent).not.toContain('confirmed record');
    expect(rows[0].getAttribute('href')).toBe('/people/one?from=%2Fpeople');
  });

  it('shows validated person-link presence while keeping candidacy and service navigation distinct', async () => {
    const links = [
      { id: 'person-a', name: 'Held person A' },
      { id: 'person-b', name: 'Held person B' },
    ];
    await render('/people', async (url) => {
      const body = await loaded(url).json();
      return json({
        ...body.data,
        rows: [
          { kind: 'candidate', id: 'candidate-a', name: 'Linked candidate', person_links: links },
          { ...legislator(1), person_links: links },
          { kind: 'candidate', id: 'candidate-b', name: 'Unlinked candidate', person_links: [] },
          { ...legislator(2), person_links: [] },
        ],
      });
    });
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('.pp-row')];
    expect(rows[0].textContent).toContain('Linked to person profile');
    expect(rows[1].textContent).toContain('Linked to person profile');
    expect(rows[2].textContent).toContain('Minnesota Secretary of State');
    expect(rows[3].textContent).toContain('Minnesota Legislature');
    expect(rows[0].getAttribute('href')).toBe('/candidates/candidate-a?from=%2Fpeople');
    expect(rows[1].getAttribute('href')).toBe('/legislators/member-01?from=%2Fpeople');
    expect(container.querySelector('a[href^="/people/person-a"]')).toBeNull();
    expect(container.querySelector('a[href^="/people/person-b"]')).toBeNull();
    expect(rows[0].textContent).not.toContain('Held person A');
  });

  it.each([
    [
      'candidates',
      'party=DFL&office=County%20Sheriff',
      ['Party (as filed): DFL', 'Office: County Sheriff'],
    ],
    [
      'legislators',
      'party=DFL&chamber=house',
      ['Chamber: House', 'Party (Legislature record): DFL'],
    ],
  ])(
    'uses held source filters for %s and clears them when changing type',
    async (type, filters, labels) => {
      await render(`/people?type=${type}&${filters}&page=2`, async (url) => {
        const response = await loaded(url).json();
        return json({
          ...response.data,
          parties: ['DFL', 'Republican'],
          offices: ['County Sheriff'],
          chambers: ['house', 'senate'],
        });
      });
      const request = new URL(requests.find((url) => url.includes('/finance/people?'))!);
      expect(request.searchParams.get('party')).toBe('DFL');
      expect(request.searchParams.get(type === 'candidates' ? 'office' : 'chamber')).toBe(
        type === 'candidates' ? 'County Sheriff' : 'house',
      );
      for (const label of labels) expect(text()).toContain(label);
      await act(async () => button(labels[0]).click());
      await act(async () => button(type === 'candidates' ? 'Republican' : 'Senate').click());
      await settle();
      const latest = new URL(requests.filter((url) => url.includes('/finance/people?')).at(-1)!);
      expect(latest.searchParams.get('offset')).toBe('0');
      expect(latest.searchParams.has('version')).toBe(false);
      await act(async () => button('All records').click());
      await settle();
      expect(window.location.search).toBe('');
      expect(text()).not.toContain('Party (');
    },
  );

  it('shows the service term that matched a past district without calling it current service', async () => {
    const current = legislator(1);
    const matching = {
      ...current.periods[0],
      chamber: 'house',
      district: '32A',
      party: 'DFL',
      start_date: '2019-01-08',
      end_date: '2021-01-04',
      session: '2019-2020',
    };
    await render('/people?type=legislators&q=32A', async (url) => {
      const response = await loaded(url).json();
      return json({
        ...response.data,
        total: 1,
        rows: [{ ...current, matching_periods: [matching] }],
      });
    });
    const row = container.querySelector('.pp-row')!;
    expect(row.textContent).toContain('House District 32A');
    expect(row.textContent).toContain('Jan 8, 2019');
    expect(row.textContent).toContain('Jan 4, 2021');
    expect(row.textContent).not.toContain('Senate District 1A');
    expect(row.textContent).not.toContain('Serving');
    expect(container.querySelector('label[for="people-name"]')?.textContent).toBe(
      'Search by name or district',
    );
  });

  it('lists service records 10 a page, each with its mark, kind and return context', async () => {
    await render('/people?type=legislators&service=current', loaded);
    expect(
      requests.some(
        (url) =>
          url.includes('/finance/people?') &&
          url.includes('service=current') &&
          url.includes('limit=10'),
      ),
    ).toBe(true);
    expect(text()).toContain('23 service records');
    const rows = container.querySelectorAll('.pp-row');
    expect(rows).toHaveLength(10);
    expect(rows[0].querySelector('.f-mark')).not.toBeNull();
    expect(rows[0].textContent).toContain('Member 01');
    expect(rows[0].textContent).toContain('Senate District 1A · Serving');
    expect(rows[0].textContent).toContain('LEGISLATOR');
    expect(rows[0].getAttribute('href')).toBe(
      '/legislators/member-01?from=%2Fpeople%3Ftype%3Dlegislators%26service%3Dcurrent',
    );
    // The Home entrance's choices are honoured.
    expect(button('Legislators').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('Service: Current');
    expect(text()).toContain('Page 1 of 3');
  });

  it('pages through the address', async () => {
    await render('/people', loaded);
    await act(async () => button('Next').click());
    await settle();
    expect(window.location.search).toBe('?page=2');
    expect(text()).toContain('Page 2 of 3');
    expect(container.querySelector('.pp-row')?.textContent).toContain('Member 11');
    expect(button('Previous').getAttribute('aria-disabled')).toBeNull();
  });

  it('pins later pages and reloads the whole list after the source changes', async () => {
    let changed = false;
    await render('/people', (url) => {
      const query = new URL(url).searchParams;
      if (query.get('offset') === '10' && !changed) {
        changed = true;
        return new Response(
          JSON.stringify({ type: 'https://api.alethical.com/problems/records-changed' }),
          { status: 409 },
        );
      }
      return loaded(url);
    });
    await act(async () => button('Next').click());
    await settle();
    const next = requests.find((url) => new URL(url).searchParams.get('offset') === '10')!;
    expect(new URL(next).searchParams.get('version')).toBe('aaaaaaaaaaaaaaaa');
    expect(text()).toContain('These records changed. Reload the list');
    expect(text()).toContain('Member 01');
    await act(async () => button('Try again').click());
    await settle();
    expect(text()).toContain('Page 1 of 3');
    expect(text()).not.toContain('These records changed');
    const last = requests.filter((url) => url.includes('/finance/people?')).at(-1)!;
    expect(new URL(last).searchParams.get('offset')).toBe('0');
    expect(new URL(last).searchParams.has('version')).toBe(false);
  });

  it('searches by name on Search and says when nothing matches', async () => {
    await render('/people', loaded);
    const input = container.querySelector<HTMLInputElement>('#people-name')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Nobody');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(window.location.search).toBe('?q=Nobody');
    expect(requests.some((url) => url.includes('q=Nobody'))).toBe(true);
    expect(text()).toContain('0 people · 0 candidacies · 0 service records matching “Nobody”');
    expect(text()).toContain('No matching records');
  });

  it('shows the 3 loading rows on the first load', async () => {
    window.history.replaceState(null, '', '/people');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await act(async () => {
      root.render(<People match={matchRoute('/people')!} />);
    });
    expect(container.querySelector('.f-skeleton')).not.toBeNull();
  });

  it('shows a failure with Try again, never an empty result', async () => {
    await render('/people', (url) =>
      url.includes('/finance/people') ? new Response(null, { status: 500 }) : json({}),
    );
    expect(text()).toContain('We couldn’t load these results. This is a problem on our side.');
    expect(text()).not.toContain('No matching records');
    expect(button('Try again')).toBeDefined();
  });

  it('sends only filter values the server accepts', async () => {
    await render('/people?type=legislators&service=x', loaded);
    expect(new URL(requests[0]).searchParams.get('service')).toBeNull();
    await render('/people?type=candidates&scope=x&year=12', loaded);
    const params = new URL(requests.at(-1)!).searchParams;
    expect(params.get('scope')).toBe('all');
    expect(params.get('year')).toBeNull();
  });

  it('sends candidate scope, year and sort to the whole directory', async () => {
    await render('/people?type=candidates&scope=past&year=2024&sort=election_year', loaded);
    const params = new URL(requests[0]).searchParams;
    expect(params.get('type')).toBe('candidates');
    expect(params.get('scope')).toBe('past');
    expect(params.get('year')).toBe('2024');
    expect(params.get('sort')).toBe('election_year');
    expect(button('Candidates').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('Election year: Past candidates');
    expect(text()).toContain('Sort by: Election year');
  });

  it('shows no return link on this top-level destination, whatever the address carries', async () => {
    await render('/people?type=legislators&from=%2Fhome', loaded);
    expect(container.querySelector('.f-back')).toBeNull();
  });

  it('keeps person and candidacy records separate even for the same name', async () => {
    const rows: PersonDirectoryRow[] = [
      { kind: 'person', id: 'person-a', name: 'Same Name' },
      { kind: 'candidate', id: 'candidacy-a', name: 'Same Name', year: 2026, office: 'Senate' },
    ];
    await render('/people', () =>
      json({
        state: 'reported',
        rows,
        total: 2,
        counts: { person: 1, candidate: 1, legislator: 0 },
        years: [2026],
        limit: 10,
        offset: 0,
        has_more: false,
        type: 'all',
      }),
    );
    expect(container.querySelectorAll('.pp-row')).toHaveLength(2);
    expect(container.querySelector('a[href^="/people/person-a"]')).toBeTruthy();
    expect(container.querySelector('a[href^="/candidates/candidacy-a"]')).toBeTruthy();
    expect(text()).toContain('1 person · 1 candidacy · 0 service records');
  });

  it('Clear all returns to every record', async () => {
    await render('/people?type=legislators&service=current', loaded);
    await act(async () => button('Clear all').click());
    expect(window.location.search).toBe('');
  });
});

describe('People controls (Design Rounds 30 to 37)', () => {
  it('offers Election year with Past candidates, and choosing one keeps it in the address', async () => {
    await render('/people?type=candidates', loaded);
    await act(async () => button('Election year: All years').click());
    const options = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['All years', 'Past candidates', '2026', '2024']);
    await act(async () => button('Past candidates').click());
    await settle();
    expect(window.location.search).toBe('?type=candidates&scope=past');
    await act(async () => button('Election year: Past candidates').click());
    await act(async () => button('2024').click());
    await settle();
    expect(window.location.search).toBe('?type=candidates&year=2024');
  });

  it('switching record type clears the other type’s filters, and All records has no menus', async () => {
    await render('/people?type=candidates&scope=past&sort=election_year', loaded);
    await act(async () => button('Legislators').click());
    await settle();
    expect(window.location.search).toBe('?type=legislators');
    expect(text()).toContain('Service: Current and former');
    expect(text()).not.toContain('Election year');
    await act(async () => button('All records').click());
    await settle();
    expect(text()).not.toContain('Service:');
    expect(text()).not.toContain('Election year:');
    expect(text()).toContain('Sort by: Name A–Z');
  });

  it('puts the count line under the controls and the background below the results', async () => {
    await render('/people', loaded);
    expect(container.querySelector('.f-count-line')?.textContent).toBe(
      '0 people · 0 candidacies · 23 service records',
    );
    expect(text()).toContain('Candidacy or an election result does not prove current service');
    expect(text()).not.toContain('current service.');
    const about = container.querySelector('#about-h')?.parentElement;
    expect(about?.textContent).toContain('About these records');
    expect(about?.textContent).toContain(
      'Minnesota records only; candidate lookup is not a complete national directory',
    );
  });

  it('asks for another name only when a name was typed', async () => {
    // The server holds no former legislators: an empty answer to a filter alone.
    await render('/people?type=legislators&service=former', (url) =>
      url.includes('service=former') ? loaded(`${url}&q=nobody-at-all`) : loaded(url),
    );
    expect(text()).toContain('No matching records');
    expect(text()).not.toContain('Try another name');
  });

  it('says what to try when nothing matches', async () => {
    await render('/people?q=Nobody', loaded);
    expect(text()).toContain('No matching records');
    expect(text()).toContain('Try another name');
    expect(text()).not.toContain('does not prove current service');
  });
});

describe('People wording', () => {
  it('counts what it lists', () => {
    expect(countLine(1, '')).toBe('1 service record');
    expect(countLine(1203, 'ann')).toBe('1,203 service records matching “ann”');
  });

  it('never prints a seat the record does not name', () => {
    // The served candidate row (GET /api/v1/finance/people, 3 Nov 2026): the
    // election is an object, never interpolated whole ("[object Object]").
    const candidate = {
      kind: 'candidate',
      id: 'c-1',
      name: 'Example Candidate',
      year: 2026,
      election: {
        date: '2026-11-03',
        id: '8334',
        label: 'November 3, 2026 general election',
        type: 'general',
      },
      office: 'State Representative District 56A',
      voting_area: 'House District 56A',
      source: { checkedDate: '2026-11-02', url: 'https://myballotmn.sos.mn.gov/' },
    } as PersonDirectoryRow;
    // The drawing's row, with the district printed once.
    expect(rowNote(candidate)).toBe('2026 general · State Representative, District 56A');
    expect(rowNote(candidate)).not.toContain('[object');
    expect(rowNote({ ...candidate, party: 'DFL' })).toBe(
      '2026 general · State Representative, District 56A · DFL',
    );
    // Every office and area pair the live People list served on 3 Nov 2026:
    // each fact once, nothing lost.
    const seats: Array<[string, string, string]> = [
      [
        'State Representative District 56A',
        'House District 56A',
        'State Representative, District 56A',
      ],
      ['State Senator District 60', 'Senate District 60', 'State Senator, District 60'],
      [
        'School Board Member (ISD #272)',
        'ISD #272 · Whole district',
        'School Board Member, ISD #272, Whole district',
      ],
      ['County Sheriff', 'Cass County', 'County Sheriff, Cass County'],
      [
        'County Commissioner District 3',
        'Hennepin County · District 3',
        'County Commissioner, District 3, Hennepin County',
      ],
      [
        'School Board Member District 1 (SSD #1)',
        'SSD #1 · Member district 1',
        'School Board Member, District 1, SSD #1',
      ],
      [
        'Council Member (Wayzata)',
        'Council Member (Wayzata) (Elect 2) · Hennepin County',
        'Council Member (Wayzata), Hennepin County',
      ],
      ['Judge - 1st District Court 36', 'Judicial District 1st', 'Judge - 1st District Court 36'],
      [
        'School Board Member District 4 (SSD #1)',
        'Minneapolis Public Schools · SSD #1',
        'School Board Member, District 4, Minneapolis Public Schools, SSD #1',
      ],
      [
        'School Board Member At Large (SSD #1)',
        'Minneapolis Public Schools · SSD #1',
        'School Board Member At Large, Minneapolis Public Schools, SSD #1',
      ],
    ];
    for (const [office, area, seat] of seats) expect(candidateSeat(office, area)).toBe(seat);
    expect(candidateSeat('Governor', 'Statewide')).toBe('Governor, Statewide');
    expect(candidateSeat('County Commissioner', undefined)).toBe('County Commissioner');
    expect(candidateSeat(undefined, 'House District 56A')).toBe('House District 56A');
    expect(rowNote({ kind: 'legislator', id: 'x', name: 'X', service_status: 'unknown' })).toBe(
      'Current service not confirmed',
    );
    expect(rowNote({ kind: 'legislator', id: 'x', name: 'X', service_status: 'former' })).toBe(
      'Formerly served',
    );
  });

  it('prints a candidacy’s election and seat, and a legislator’s party only where held', () => {
    expect(
      rowNote({
        kind: 'candidate',
        id: 'c',
        name: 'C',
        year: 2026,
        election: { type: 'general' },
        office: 'State Representative',
        voting_area: 'District 45B',
      }),
    ).toBe('2026 general · State Representative, District 45B');
    const period = {
      chamber: 'house',
      district: '45B',
      party: 'DFL',
      start_date: null,
      end_date: null,
      session: null,
      source_url: null,
    };
    expect(
      rowNote({
        kind: 'legislator',
        id: 'l',
        name: 'L',
        service_status: 'current',
        periods: [period],
      }),
    ).toBe('House District 45B · DFL · Serving');
    expect(
      rowNote({
        kind: 'legislator',
        id: 'l',
        name: 'L',
        service_status: 'current',
        periods: [{ ...period, party: null }],
      }),
    ).toBe('House District 45B · Serving');
  });
});
