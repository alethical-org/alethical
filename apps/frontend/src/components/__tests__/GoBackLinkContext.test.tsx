// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoBackLink } from '../GoBackLink';
import { initializeWebHistory, pushWebHistory } from '../../navigation/webHistory';
import {
  setReturnAccess,
  rememberReturnPageName,
  forgetReturnPageName,
} from '../../navigation/returnDestination';

vi.mock('react-native-svg', () => ({
  default: (props: object) => createElement('svg', props),
  Path: (props: object) => createElement('path', props),
}));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState({}, '', '/bills');
  initializeWebHistory();
  setReturnAccess(null, false);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () =>
  act(() => root.render(<GoBackLink href="/" destinationName="Home" onPress={vi.fn()} />));

it('changes text, accessible name and href before use after account access is lost', () => {
  setReturnAccess('fixture-admin', true);
  window.history.replaceState(window.history.state, '', '/admin/users');
  rememberReturnPageName('/admin/users', 'Users');
  pushWebHistory('/about/contact');
  render();
  expect(host.querySelector('a')?.getAttribute('aria-label')).toBe('Back to Users');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/admin/users');
  act(() => setReturnAccess(null, false));
  expect(host.querySelector('a')?.textContent).toBe('Back to Home');
  expect(host.querySelector('a')?.getAttribute('aria-label')).toBe('Back to Home');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/');
});
it('replaces a return to a confirmed missing record before the reader clicks it', () => {
  window.history.replaceState(window.history.state, '', '/legislators/example-forgotten');
  rememberReturnPageName('/legislators/example-forgotten', 'Rep. Example');
  pushWebHistory('/about/contact');
  render();
  expect(host.querySelector('a')?.textContent).toBe('Back to Rep. Example');
  act(() => forgetReturnPageName('/legislators/example-forgotten'));
  expect(host.querySelector('a')?.textContent).toBe('Back to Home');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/');
});
