// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type ScrollView } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActiveBillChip } from '../useActiveBillChip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let mount: HTMLDivElement;
let strip: HTMLDivElement;
let chip: HTMLButtonElement;
let ref: { current: ScrollView | null };
let reveal: () => void;
const rect = (left: number, right: number) => ({ left, right }) as DOMRect;
function Reader({ active = 'summary' }: { active?: string }) {
  reveal = useActiveBillChip(ref, active);
  return null;
}
beforeEach(() => {
  mount = document.createElement('div');
  strip = document.createElement('div');
  chip = document.createElement('button');
  chip.setAttribute('aria-current', 'location');
  strip.append(chip);
  document.body.append(mount, strip);
  ref = { current: { getScrollableNode: () => strip } as unknown as ScrollView };
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(rect(0, 375));
  vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue(rect(422, 515));
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  strip.remove();
});
it('reveals an offscreen selected chip horizontally without scrolling vertically or moving focus', () => {
  strip.scrollTop = 217;
  chip.focus();
  act(() => root.render(<Reader active="fulltext" />));
  expect(strip.scrollLeft).toBe(144);
  expect(strip.scrollTop).toBe(217);
  expect(document.activeElement).toBe(chip);
});
it('follows scroll-spy selection back left with the smallest movement', () => {
  act(() => root.render(<Reader active="fulltext" />));
  vi.mocked(chip.getBoundingClientRect).mockReturnValue(rect(-116, -10));
  act(() => root.render(<Reader active="summary" />));
  expect(strip.scrollLeft).toBe(24);
});
it('leaves a fully visible chip and user-chosen strip position unchanged', () => {
  strip.scrollLeft = 40;
  vi.mocked(chip.getBoundingClientRect).mockReturnValue(rect(15, 110));
  act(() => root.render(<Reader />));
  expect(strip.scrollLeft).toBe(40);
});
it('reveals after delayed content layout and a narrower viewport', () => {
  chip.removeAttribute('aria-current');
  act(() => root.render(<Reader active="fulltext" />));
  expect(strip.scrollLeft).toBe(0);
  chip.setAttribute('aria-current', 'location');
  act(() => reveal());
  expect(strip.scrollLeft).toBe(144);
  vi.mocked(chip.getBoundingClientRect).mockReturnValue(rect(282, 375));
  vi.mocked(strip.getBoundingClientRect).mockReturnValue(rect(0, 320));
  act(() => reveal());
  expect(strip.scrollLeft).toBe(203);
});

it('rounds outward so browser integer scroll positions do not leave a clipped edge', () => {
  vi.mocked(chip.getBoundingClientRect).mockReturnValue(rect(315.7, 414.5));
  act(() => root.render(<Reader active="versions" />));
  expect(strip.scrollLeft).toBe(44);
});
