import type { ComponentProps, ComponentType } from 'react';

import { loadOnDemand } from '../../lib/loadOnDemand';
import type { CampaignMoneyTab as MoneyTab } from './CampaignMoneyTab';
import { preloadMoneyDetails } from './MoneyDetailsOnDemand';

let pieces: Promise<{ default: ComponentType<ComponentProps<typeof MoneyTab>> }> | undefined;

/**
 * The tab and everything its first frame needs, downloaded together.
 *
 * The charts, the payment lists and the reads behind them arrive in their own pieces
 * (`MoneyDetailsBundle`, `data/campaignMoneyDetails`). Fetched one after the other, a
 * committee card drew 3 times: its figures alone, then the chart's frame, then the
 * chart. Fetched with the tab, the card draws once, in its finished shape, and the
 * payment reads start the moment the committee is known instead of after 2 more
 * downloads. Neither optional piece can hold the tab back: a failure there reaches the
 * card's own fallback, exactly as before.
 *
 * Safe to call before the tab is on screen (the profile screens call it as soon as the
 * address names this tab, and the tab strip calls it on hover), and a second call joins
 * the first download rather than starting another.
 */
export function prefetchCampaignMoneyTab() {
  return (pieces ??= Promise.all([
    import('./CampaignMoneyTab'),
    preloadMoneyDetails().catch(() => undefined),
    import('../../data/campaignMoneyDetails').catch(() => undefined),
  ]).then(([module]) => ({ default: module.CampaignMoneyTab })));
}

/** The profile's overview and unrelated screens do not need the donation browser. */
export const CampaignMoneyTab: ComponentType<ComponentProps<typeof MoneyTab>> =
  loadOnDemand(prefetchCampaignMoneyTab);
