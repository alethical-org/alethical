// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useEntityReturnPageNames } from '../useEntityReturnPageNames';
import { forgetReturnPageName, returnPageName } from '../../navigation/returnDestination';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const requested = '/legislators/return-name-id';
const canonical = '/legislators/return-name-slug';
let host: HTMLDivElement;
let root: Root;
function PublicIdentity({
  path = requested,
  servedPath,
  name,
  missing = false,
}: {
  path?: string;
  servedPath: string | null;
  name: string | null;
  missing?: boolean;
}) {
  useEntityReturnPageNames(path, servedPath, name, missing);
  return <p>{missing ? 'Not found' : (name ?? 'Loading')}</p>;
}
function render(props: Parameters<typeof PublicIdentity>[0]) {
  act(() => root.render(<PublicIdentity {...props} />));
}
beforeEach(() => {
  forgetReturnPageName(requested);
  forgetReturnPageName(canonical);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('forgets the loaded identity and its alias after a confirmed missing response, even with retained data', () => {
  render({ servedPath: canonical, name: 'Rep. Served Name' });
  expect(returnPageName(requested)).toBe('Rep. Served Name');
  expect(returnPageName(canonical)).toBe('Rep. Served Name');
  render({ servedPath: canonical, name: 'Rep. Served Name', missing: true });
  expect(returnPageName(requested)).toBeNull();
  expect(returnPageName(canonical)).toBeNull();
});
it('keeps the known identity through loading or a temporary failure without borrowing it for a different record', () => {
  render({ servedPath: canonical, name: 'Rep. Served Name' });
  render({ servedPath: null, name: null });
  expect(returnPageName(requested)).toBe('Rep. Served Name');
  render({ path: '/legislators/unserved-new-id', servedPath: null, name: null });
  expect(returnPageName('/legislators/unserved-new-id')).toBeNull();
  expect(returnPageName(canonical)).toBe('Rep. Served Name');
});
it('forgets the earlier alias on a confirmed missing revisit after a different record loaded', () => {
  render({ servedPath: canonical, name: 'Rep. Served Name' });
  render({
    path: '/legislators/second-id',
    servedPath: '/legislators/second-slug',
    name: 'Sen. Other Name',
  });
  render({ servedPath: null, name: null, missing: true });
  expect(returnPageName(requested)).toBeNull();
  expect(returnPageName(canonical)).toBeNull();
  expect(returnPageName('/legislators/second-slug')).toBe('Sen. Other Name');
});
