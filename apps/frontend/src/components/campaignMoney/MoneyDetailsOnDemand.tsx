import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { requestReleaseReload } from '../../lib/releaseReload';
import {
  moneyDetailsPageCopy as copy,
  namedMoneyDefinition,
} from '../../lib/campaignMoneyDetailsPageCopy';
import { unnamedFigureDraws } from '../../lib/contributionFigures';
import { Dek } from './ContributionLabelsNote';
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
const OutsideSummary = lazy(() =>
  load().then((module) => ({ default: module.OutsideSpendingCard })),
);
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
  // What separates the 2 contribution figures. The chart normally carries it in its dek,
  // and the chart arrives in a separately downloaded piece, so both fallbacks draw it
  // themselves: the money cards below them are already showing both figures, and rule 12
  // does not let those stand with no sentence between them (#2182).
  const definition = unnamedFigureDraws(props.committee.split)
    ? namedMoneyDefinition(props.isBallot ?? false)
    : [];
  return (
    <DetailsBoundary
      fallback={
        <>
          <FailedDetails message={copy.chartFailed} />
          <Dek segments={definition} />
          {props.children}
        </>
      }
    >
      <Suspense
        fallback={
          <>
            <Text style={s.body}>{copy.chartLoading}</Text>
            <Dek segments={definition} />
            {props.children}
          </>
        }
      >
        <Donations {...props} />
      </Suspense>
    </DetailsBoundary>
  );
}
function OutsideDetails({ children }: { children: ReactNode }) {
  const s = useDetailsStyles();
  return (
    <DetailsBoundary fallback={<FailedDetails message={copy.outsideFailed} />}>
      <Suspense fallback={<Text style={s.body}>{copy.outsideLoading}</Text>}>{children}</Suspense>
    </DetailsBoundary>
  );
}
export function GroupedOutsideSpending(
  props: ComponentProps<typeof Details.GroupedOutsideSpending>,
) {
  return (
    <OutsideDetails>
      <Outside {...props} />
    </OutsideDetails>
  );
}
export function OutsideSpendingCard(props: ComponentProps<typeof Details.OutsideSpendingCard>) {
  return (
    <OutsideDetails>
      <OutsideSummary {...props} />
    </OutsideDetails>
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
