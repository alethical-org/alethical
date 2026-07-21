import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RootStackParamList } from '../navigation/types';
import { useResponsive } from '../hooks/useResponsive';
import { LegislatorProfileWebScreen } from './redesign/LegislatorProfileWebScreen';
import { LegislatorProfileMobileScreen } from './redesign/LegislatorProfileMobileScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'LegislatorProfile'>;

// Responsive dispatcher (same pattern as BillDetailScreen): the redesigned web
// Legislator Profile on desktop; the redesigned mobile screen on phones. Both
// read the route (legislatorId) themselves, so no props are threaded through.
export function LegislatorProfileScreen(_props: Props) {
  const { isDesktop } = useResponsive();
  return isDesktop ? <LegislatorProfileWebScreen /> : <LegislatorProfileMobileScreen />;
}
