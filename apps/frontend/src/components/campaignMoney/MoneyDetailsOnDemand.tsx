import { Component, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
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

// The downloaded piece, kept once it has arrived. A card that mounts after the arrival
// reads it synchronously and draws its chart in its first frame. Going through
// `React.lazy` instead, an already-downloaded piece still resolved a moment after the
// first frame, so every committee card drew twice: its figures alone, then the same
// figures under the chart, which read as an old page being replaced by a new one.
let loaded: typeof Details | undefined;
let bundle: Promise<typeof Details> | undefined;

/** Start (or join) the one download; safe to call before any card exists. */
export function preloadMoneyDetails(): Promise<typeof Details> {
  return (bundle ??= import('./MoneyDetailsBundle').then(
    (module) => {
      loaded = module;
      return module;
    },
    (error) => {
      // A missing piece almost always means a release replaced it while this tab
      // was open. One reload puts the tab on the current release.
      requestReleaseReload();
      throw error;
    },
  ));
}

type Piece = 'loading' | 'failed' | typeof Details;
function useMoneyDetails(): Piece {
  const [piece, setPiece] = useState<Piece>(() => loaded ?? 'loading');
  useEffect(() => {
    if (piece !== 'loading') return;
    let current = true;
    preloadMoneyDetails().then(
      (module) => {
        if (current) setPiece(module);
      },
      () => {
        if (current) setPiece('failed');
      },
    );
    return () => {
      current = false;
    };
  }, [piece]);
  return piece;
}

// Optional details must never remove the accepted filing figures if the downloaded
// piece throws while drawing.
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
  const piece = useMoneyDetails();
  // What separates the 2 contribution figures. The chart normally carries it in its dek,
  // and the chart arrives in a separately downloaded piece, so both fallbacks draw it
  // themselves: the money cards below them are already showing both figures, and rule 12
  // does not let those stand with no sentence between them (#2182).
  const definition = unnamedFigureDraws(props.committee.split)
    ? namedMoneyDefinition(props.isBallot ?? false)
    : [];
  const failed = (
    <>
      <FailedDetails message={copy.chartFailed} />
      <Dek segments={definition} />
      {props.children}
    </>
  );
  if (piece === 'failed') return failed;
  if (piece === 'loading') {
    return (
      <>
        <Text style={s.body}>{copy.chartLoading}</Text>
        <Dek segments={definition} />
        {props.children}
      </>
    );
  }
  const Donations = piece.CommitteeDonations;
  return (
    <DetailsBoundary fallback={failed}>
      <Donations {...props} />
    </DetailsBoundary>
  );
}
function OutsideDetails({
  piece,
  children,
}: {
  piece: Piece;
  children: (details: typeof Details) => ReactNode;
}) {
  const s = useDetailsStyles();
  if (piece === 'failed') return <FailedDetails message={copy.outsideFailed} />;
  if (piece === 'loading') return <Text style={s.body}>{copy.outsideLoading}</Text>;
  return (
    <DetailsBoundary fallback={<FailedDetails message={copy.outsideFailed} />}>
      {children(piece)}
    </DetailsBoundary>
  );
}
export function GroupedOutsideSpending(
  props: ComponentProps<typeof Details.GroupedOutsideSpending>,
) {
  const piece = useMoneyDetails();
  return (
    <OutsideDetails piece={piece}>
      {(details) => <details.GroupedOutsideSpending {...props} />}
    </OutsideDetails>
  );
}
export function OutsideSpendingCard(props: ComponentProps<typeof Details.OutsideSpendingCard>) {
  const piece = useMoneyDetails();
  return (
    <OutsideDetails piece={piece}>
      {(details) => <details.OutsideSpendingCard {...props} />}
    </OutsideDetails>
  );
}
export function CommitteeMixHistory(props: ComponentProps<typeof Details.CommitteeMixHistory>) {
  const piece = useMoneyDetails();
  if (piece === 'loading' || piece === 'failed') return null;
  const History = piece.CommitteeMixHistory;
  return (
    <DetailsBoundary fallback={null}>
      <History {...props} />
    </DetailsBoundary>
  );
}
