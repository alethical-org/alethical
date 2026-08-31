import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAV_BAR } from '../../navigation/ia';
import { NAV_ITEM_HREFS, currentNavItemId } from '../../navigation/topNavRoutes';

/**
 * The nav marks the page a reader is on, and nothing about that is visible.
 *
 * `aria-current` is not typed by React Native, so removing one is not a compile
 * error; it draws no ink, so removing one changes no screenshot; and no other
 * check in the repo reads it. The mark can therefore vanish in a styling change
 * and nobody would see it. It has vanished once already in effect: the nav went
 * without it entirely while 4 other surfaces carried it
 * (docs/architecture/published-writing-decisions.md §2.13).
 *
 * So this pins 2 things a browser reading cannot pin reliably, because a phone
 * page keeps the previous screen's own nav mounted and invisible underneath, and
 * reading that copy shows no mark quite correctly.
 *
 * The rule itself, in one line: a row that links to the current page is marked,
 * and a dropdown trigger never is, because a trigger opens a panel and is not a
 * page.
 */
// Comments stripped first, so a check reads code rather than prose. Without
// this, the doc comment ABOVE the next function lands inside the previous
// function's slice, and the trigger appeared to carry an attribute that only its
// neighbour's comment mentioned.
const PRIMITIVES = readFileSync(join(__dirname, '..', 'primitives.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

/** One component's code, from its `function` line to the next top-level declaration. */
function componentSource(name: string): string {
  const start = PRIMITIVES.indexOf(`function ${name}(`);
  expect(start, `${name} is gone from primitives.tsx`).toBeGreaterThan(-1);
  const rest = PRIMITIVES.slice(start + `function ${name}(`.length);
  const next = rest.search(/\n(?:export )?(?:function|const) /);
  return next === -1 ? rest : rest.slice(0, next);
}

// Every nav row a reader can click, at both widths: the computer band's Read
// item, the rows inside a computer dropdown, the rows under a phone drawer
// heading, and the phone drawer's own bar-item row.
const MARKED_ROWS = ['NavBarLink', 'MenuPanelRow', 'MenuDrawerRow', 'MenuDrawerBarRow'] as const;

describe('the nav marks the page a reader is on', () => {
  it.each(MARKED_ROWS)('%s carries aria-current when it is the current page', (component) => {
    expect(componentSource(component)).toContain("aria-current={current ? 'page' : undefined}");
  });

  it.each(MARKED_ROWS)('%s is handed whether it is current', (component) => {
    // A row that carries the attribute but is never told `current` is marked
    // nowhere, which reads exactly like having no attribute at all.
    expect(componentSource(component)).toContain('current: boolean');
  });

  it('never marks a dropdown trigger, which opens a panel and is not a page', () => {
    expect(componentSource('NavDropdownTrigger')).not.toContain('aria-current');
  });

  it('drives every mark off the live route, never off window.location', () => {
    // The address bar is written in an effect after the screen renders, so
    // reading it here would leave the mark one navigation behind.
    const hook = componentSource('useCurrentNavItemId');
    expect(hook).toContain('useRoute()');
    expect(hook).not.toContain('window.location');
  });

  it('marks the bar item whose href is the page, for every bar entry that is a destination', () => {
    for (const entry of NAV_BAR) {
      if (entry.kind !== 'link') continue;
      const href = NAV_ITEM_HREFS[entry.item.id];
      expect(href, `${entry.item.id} is a bar destination with no link`).toBeTruthy();
      expect(currentNavItemId(href)).toBe(entry.item.id);
    }
  });
});
