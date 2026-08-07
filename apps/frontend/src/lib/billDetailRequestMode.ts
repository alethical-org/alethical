export type BillDetailTab = 'summary' | 'actions' | 'votes' | 'text' | 'versions';

export function billDetailNeedsVotes(isDesktop: boolean, tab: BillDetailTab): boolean {
  return !isDesktop || tab === 'actions' || tab === 'votes';
}

export function billDetailVotePrefetchIsUseful(tab: BillDetailTab): boolean {
  return tab === 'actions' || tab === 'votes';
}
