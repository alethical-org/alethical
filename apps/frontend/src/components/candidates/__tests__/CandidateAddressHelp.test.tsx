// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateAddressForm } from '../CandidateAddressForm';
import type { CandidateSearchServices } from '../types';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Path: () => <path />,
  Circle: () => <circle />,
}));
const help = 'A city or ZIP code alone cannot identify your local races';
const services: CandidateSearchServices = {
  getElections: async () => [],
  suggest: async () => [],
  lookup: async () => ({ kind: 'no-match' }),
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(compact: boolean) {
  act(() =>
    root.render(
      <CandidateAddressForm
        services={services}
        address="100 Example Street, Minneapolis, MN 55415"
        onAddress={() => {}}
        onSubmit={() => {}}
        busy={false}
        outcome={null}
        compact={compact}
        onCancel={compact ? () => {} : undefined}
      />,
    ),
  );
  const field = host.querySelector('textarea')!;
  const described = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return { field, described };
}
it('prints no help line in Change address and names only existing descriptions', () => {
  const { described } = render(true);
  expect(host.textContent).not.toContain(help);
  expect(described.length).toBeGreaterThan(0);
  for (const id of described) expect(document.getElementById(id)).not.toBeNull();
  expect(described.some((id) => id.endsWith('-help'))).toBe(false);
});
it('keeps the help line on the entry form and describes the field with it', () => {
  const { described } = render(false);
  expect(host.textContent?.split(help).length).toBe(2);
  const helpId = described.find((id) => id.endsWith('-help'));
  expect(helpId && document.getElementById(helpId)?.textContent).toBe(help);
});
