// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { PageContextLabel } from '../PageContextLabel';

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

it('draws every green page label in capitals without rewriting its readable text', () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  act(() => root!.render(<PageContextLabel>Money by race</PageContextLabel>));

  const label = host.querySelector<HTMLElement>('[data-testid="page-context-label"]');
  expect(label?.textContent).toBe('Money by race');
  expect(getComputedStyle(label!).textTransform).toBe('uppercase');
});
