import type { ComponentProps, ComponentType } from 'react';

import { loadOnDemand } from '../../lib/loadOnDemand';
import type { CampaignMoneyTab as MoneyTab } from './CampaignMoneyTab';

/** The profile's overview and unrelated screens do not need the donation browser. */
export const CampaignMoneyTab: ComponentType<ComponentProps<typeof MoneyTab>> = loadOnDemand(() =>
  import('./CampaignMoneyTab').then((module) => ({ default: module.CampaignMoneyTab })),
);
