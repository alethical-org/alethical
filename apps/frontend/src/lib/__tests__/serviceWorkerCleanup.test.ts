import { describe, expect, it, vi } from 'vitest';

import { unregisterServiceWorkers } from '../serviceWorkerCleanup';

describe('unregisterServiceWorkers', () => {
  it('removes every saved-site worker the app finds', async () => {
    const first = { unregister: vi.fn().mockResolvedValue(true) };
    const second = { unregister: vi.fn().mockResolvedValue(true) };
    const getRegistrations = vi.fn().mockResolvedValue([first, second]);

    await unregisterServiceWorkers({
      serviceWorker: { getRegistrations },
    } as unknown as Navigator);

    expect(first.unregister).toHaveBeenCalledOnce();
    expect(second.unregister).toHaveBeenCalledOnce();
  });

  it('does nothing in browsers without saved-site worker support', async () => {
    await expect(unregisterServiceWorkers({} as Navigator)).resolves.toBeUndefined();
  });
});
