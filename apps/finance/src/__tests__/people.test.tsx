import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { countLine, People, rowNote } from '../pages/People';
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
    full_name: `Member ${n}`,
    current_service: { chamber: index % 2 ? 'senate' : 'house', district: { code: `${index}A` } },
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
  if (url.includes('/finance/landing/counts')) {
    return json({
      current_legislature_bills: {
        state: 'reported',
        count: 1,
        first_year: 2025,
        last_year: 2026,
        copied_at: '2026-10-20T15:00:00Z',
      },
    });
  }
  const q = new URL(url).searchParams.get('q');
  return json(q ? ROWS.filter((row) => row.full_name.includes(q)) : ROWS);
};

const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('People', () => {
  it('lists service records 10 a page, each with its mark, kind and return context', async () => {
    await render('/people?type=legislators&service=current', loaded);
    expect(requests.some((url) => url.endsWith('/legislators?limit=250'))).toBe(true);
    expect(text()).toContain('23 service records');
    const rows = container.querySelectorAll('.pp-row');
    expect(rows).toHaveLength(10);
    expect(rows[0].querySelector('.f-mark')).not.toBeNull();
    expect(rows[0].textContent).toContain('Member 01');
    expect(rows[0].textContent).toContain('Senate District 1A · Currently serving');
    expect(rows[0].textContent).toContain('LEGISLATOR');
    expect(rows[0].getAttribute('href')).toBe(
      '/legislators/member-01?from=%2Fpeople%3Ftype%3Dlegislators%26service%3Dcurrent',
    );
    // The Home entrance's choices are honoured.
    expect(button('Legislators').getAttribute('aria-pressed')).toBe('true');
    expect(button('Current').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('Page 1 of 3');
    expect(text()).toContain('Service records · updated Oct 20, 2026');
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
    expect(text()).toContain('0 service records matching “Nobody”');
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
      url.includes('/legislators') ? new Response(null, { status: 500 }) : json({}),
    );
    expect(text()).toContain('We couldn’t load these results. This is a problem on our side.');
    expect(text()).not.toContain('No matching records');
    expect(button('Try again')).toBeDefined();
  });

  it('offers no candidate or former-service filter it cannot answer', async () => {
    await render('/people?type=candidates', loaded);
    expect(button('Candidates')).toBeUndefined();
    expect(button('Former')).toBeUndefined();
    expect(button('All records').getAttribute('aria-pressed')).toBe('true');
  });

  it('Clear all returns to every record', async () => {
    await render('/people?type=legislators&service=current', loaded);
    await act(async () => button('Clear all').click());
    expect(window.location.search).toBe('');
  });
});

describe('People wording', () => {
  it('counts what it lists', () => {
    expect(countLine(1, '')).toBe('1 service record');
    expect(countLine(1203, 'ann')).toBe('1,203 service records matching “ann”');
  });

  it('never prints a seat the record does not name', () => {
    expect(rowNote({ id: 'x', slug: 'x', full_name: 'X', current_service: null })).toBe(
      'Currently serving',
    );
  });
});
