import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { requestReleaseReload } from '../../lib/releaseReload';
import { moneyDetailsPageCopy as copy } from '../../lib/campaignMoneyDetailsPageCopy';
import { useDetailsStyles } from './detailsStyles';
import type * as Details from './MoneyDetailsBundle';

let bundle: Promise<typeof Details> | undefined;
const load = () =>
  (bundle ??= import('./MoneyDetailsBundle').catch((error) => {
    requestReleaseReload();
    throw error;
  }));
const Donations = lazy(() => load().then((module) => ({ default: module.CommitteeDonations })));
const Outside = lazy(() => load().then((module) => ({ default: module.GroupedOutsideSpending })));
const History = lazy(() => load().then((module) => ({ default: module.CommitteeMixHistory })));

// Optional details must never remove the accepted filing figures if a release's
// downloaded piece is unavailable after the one automatic reload is exhausted.
class DetailsBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function FailedDetails({ message }: { message: string }) {
  const s = useDetailsStyles();
  return (
    <View style={s.section}>
      <Text style={s.body}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => globalThis.location?.reload()}
        style={s.control}
      >
        <Text style={s.controlText}>{copy.refreshRecords}</Text>
      </Pressable>
    </View>
  );
}
export function CommitteeDonations(props: ComponentProps<typeof Details.CommitteeDonations>) {
  const s = useDetailsStyles();
  return (
    <DetailsBoundary
      fallback={
        <>
          <FailedDetails message={copy.chartFailed} />
          {props.children}
        </>
      }
    >
      <Suspense
        fallback={
          <>
            <Text style={s.body}>{copy.chartLoading}</Text>
            {props.children}
          </>
        }
      >
        <Donations {...props} />
      </Suspense>
    </DetailsBoundary>
  );
}
export function GroupedOutsideSpending(
  props: ComponentProps<typeof Details.GroupedOutsideSpending>,
) {
  const s = useDetailsStyles();
  return (
    <DetailsBoundary fallback={<FailedDetails message={copy.outsideFailed} />}>
      <Suspense fallback={<Text style={s.body}>{copy.outsideLoading}</Text>}>
        <Outside {...props} />
      </Suspense>
    </DetailsBoundary>
  );
}
export function CommitteeMixHistory(props: ComponentProps<typeof Details.CommitteeMixHistory>) {
  return (
    <DetailsBoundary fallback={null}>
      <Suspense fallback={null}>
        <History {...props} />
      </Suspense>
    </DetailsBoundary>
  );
}
