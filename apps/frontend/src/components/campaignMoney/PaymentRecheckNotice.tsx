import { Pressable, Text, View } from 'react-native';
import { moneyDetailsPageCopy as copy } from '../../lib/campaignMoneyDetailsPageCopy';
import { useDetailsStyles } from './detailsStyles';
import { useFinePointerHover } from './finePointerHover';

/** The held list can have rows or be the committee page's accepted empty result. */
export function PaymentRecheckNotice({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  const s = useDetailsStyles();
  const hover = useFinePointerHover();
  return (
    <View style={s.section}>
      <Text accessibilityRole="alert" style={s.body}>
        {copy.heldPaymentRecheck}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: retrying, busy: retrying }}
        disabled={retrying}
        onPress={onRetry}
        onHoverIn={hover.onHoverIn}
        onHoverOut={hover.onHoverOut}
        // The app's input-aware :focus-visible ring handles keyboard focus.
        style={[
          s.control,
          !retrying &&
            hover.hovered && {
              backgroundColor: '#f7f8fa',
              borderColor: 'rgba(17,21,15,0.3)',
            },
        ]}
      >
        <Text style={s.controlText}>{copy.refreshRecords}</Text>
      </Pressable>
    </View>
  );
}
