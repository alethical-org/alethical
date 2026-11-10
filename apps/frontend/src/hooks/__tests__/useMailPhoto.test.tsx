// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useMailPhoto } from '../useMailPhoto';

it('uses exact retained bytes and revokes every URL on replacement, clearing and unmount', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const create = vi
    .fn()
    .mockReturnValueOnce('blob:front')
    .mockReturnValueOnce('blob:back')
    .mockReturnValueOnce('blob:new');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const container = document.createElement('div');
  const root = createRoot(container);
  const front = new File(['exact front'], 'front.jpg', { type: 'image/jpeg' });
  const back = new File(['exact back'], 'back.jpg', { type: 'image/jpeg' });
  let url: string | undefined;
  function Probe({ file }: { file?: File }) {
    url = useMailPhoto(file);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe, { file: front })));
    expect(create).toHaveBeenCalledWith(front);
    expect(url).toBe('blob:front');
    await act(async () => root.render(createElement(Probe, { file: back })));
    expect(revoke).toHaveBeenCalledWith('blob:front');
    expect(url).toBe('blob:back');
    await act(async () => root.render(createElement(Probe)));
    expect(url).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('blob:back');
    await act(async () => root.render(createElement(Probe, { file: front })));
    await act(async () => root.unmount());
    expect(revoke.mock.calls.map(([value]) => value)).toEqual([
      'blob:front',
      'blob:back',
      'blob:new',
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
