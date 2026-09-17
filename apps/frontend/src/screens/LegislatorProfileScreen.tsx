import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RootStackParamList } from '../navigation/types';
import { useResponsive } from '../hooks/useResponsive';
import { prefetchCampaignMoneyTab } from '../components/campaignMoney/CampaignMoneyTabOnDemand';
import { loadAndRemember } from '../lib/loadOnDemand';
import { LegislatorProfileWebScreen } from './redesign/LegislatorProfileWebScreen';
import { LegislatorProfileMobileScreen } from './redesign/LegislatorProfileMobileScreen';

/**
 * Everything a money-tab address needs in the profile's first frame, downloaded
 * with the screen.
 *
 * The Campaign money tab and its chart code arrive in their own pieces. Both
 * profile screens start that download in an effect after they mount, so on a
 * `?tab=money` address the profile drew its header with an empty band below the
 * tab strip and filled the band about 100 ms later when the tab's code landed
 * (measured live 17 Sep 2026, 1,383 ms then 1,490 ms). When the address names
 * the tab, `screenChunks.LegislatorProfile` waits for the tab's pieces too, so
 * the first frame is the whole page. Any other address, and any address this
 * cannot read, costs nothing: the screens' own effect still fetches the tab when
 * a reader opens it. A failed piece never holds the profile back.
 *
 * Through `loadAndRemember`, never the loader alone: the tab is drawn by
 * `loadOnDemand(prefetchCampaignMoneyTab)`, which draws a piece straight only
 * when that helper recorded its arrival. Called directly, the download completed
 * and the tab still went through React's `lazy`, so the profile drew its header
 * with an empty band and the tab a frame later (measured live 17 Sep 2026,
 * 656 ms then 692 ms).
 */
export function legislatorProfileScreenPieces(
  search: string | undefined = typeof window === 'undefined' ? undefined : window.location.search,
): Promise<void> {
  if (!search) return Promise.resolve();
  const wantsMoney = new URLSearchParams(search).get('tab') === 'money';
  return wantsMoney
    ? loadAndRemember(prefetchCampaignMoneyTab)
        .then(() => undefined)
        .catch(() => undefined)
    : Promise.resolve();
}

type Props = NativeStackScreenProps<RootStackParamList, 'LegislatorProfile'>;

// Responsive dispatcher (same pattern as BillDetailScreen): the redesigned web
// Legislator Profile on desktop; the redesigned mobile screen on phones. Both
// read the route (legislatorId) themselves, so no props are threaded through.
export function LegislatorProfileScreen(_props: Props) {
  const { isDesktop } = useResponsive();
  return isDesktop ? <LegislatorProfileWebScreen /> : <LegislatorProfileMobileScreen />;
}
