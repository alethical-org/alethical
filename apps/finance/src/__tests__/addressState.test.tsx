// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useAddressState } from '../ui/addressState';

it('adds history only for an explicit view transition and preserves unrelated scope', () => {
  window.history.replaceState(null, '', '/lobbying?tab=principals&from=%2Fhome');
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  const container = document.createElement('div');
  const root = createRoot(container);
  let update: ReturnType<typeof useAddressState<{ q: string; view: string }>>[1];
  function Harness() {
    const [address, set] = useAddressState({ q: '', view: '' });
    update = set;
    return <span>{address.q}:{address.view}</span>;
  }
  try {
    act(() => root.render(<Harness />));
    act(() => update({ q: 'Xcel' }, { replace: false }));
    expect(push).toHaveBeenCalledTimes(1);
    act(() => update({ q: 'Xcel Energy' }));
    expect(replace).toHaveBeenCalledTimes(1);
    act(() => update({ view: 'principals' }, { replace: false }));
    expect(push).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('Xcel Energy:principals');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('principals');
    expect(params.get('from')).toBe('/home');
    act(() => update({ q: '', view: '' }, { replace: false }));
    expect(window.location.search).toBe('?tab=principals&from=%2Fhome');
  } finally {
    act(() => root.unmount());
    push.mockRestore();
    replace.mockRestore();
  }
});
