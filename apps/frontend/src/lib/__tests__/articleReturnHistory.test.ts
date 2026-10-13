import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { captureArticleReturn } from '../articleReturn';
import {
  initializeWebHistory,
  currentWebHistoryEntry,
  pushWebHistory,
} from '../../navigation/webHistory';
import '../../navigation/returnDestination';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://alethical.test/blog/topics/lobbying' });
  vi.stubGlobal('window', dom.window);
  initializeWebHistory();
});
afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

it('bookmarks the existing reading-list entry so copied and clicked returns agree', () => {
  const original = currentWebHistoryEntry();
  const length = window.history.length;
  const href = '/blog/topics/lobbying?post=the-money-only-goes-one-way';
  const context = captureArticleReturn(href);
  expect(context).toMatchObject({ href, entryId: original?.entryId });
  expect(window.location.pathname + window.location.search).toBe(href);
  expect(window.history.length).toBe(length);
  expect(currentWebHistoryEntry()?.entryId).toBe(original?.entryId);
  pushWebHistory('/blog/research/the-money-only-goes-one-way');
  expect(currentWebHistoryEntry()?.returnTo).toMatchObject({ href, entryId: original?.entryId });
});

it('does not label a different reading list or page as a proven earlier entry', () => {
  const original = window.location.href;
  for (const href of ['/blog/research?post=example', '/blog/topics/lobbying?page=2&post=example']) {
    expect(captureArticleReturn(href)).toEqual({ href });
    expect(window.location.href).toBe(original);
  }
});

it('treats an explicit first page as the same list without adding an entry', () => {
  window.history.replaceState(window.history.state, '', '/blog/topics/lobbying?page=1');
  expect(captureArticleReturn('/blog/topics/lobbying?post=example')?.entryId).toBe(
    currentWebHistoryEntry()?.entryId,
  );
});
