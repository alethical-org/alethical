export type IssueAnswerSortKey = 'progress' | 'action';

export const ISSUE_ANSWER_SORT_OPTIONS = [
  { key: 'progress', label: 'Legislative progress' },
  { key: 'action', label: 'Latest action' },
] as const;

export function resolveIssueAnswerSort(value: unknown): IssueAnswerSortKey {
  return value === 'action' ? 'action' : 'progress';
}

/** Pick one of the server-ranked windows. The slice is a final display guard;
 * the server already sends at most 5 under either ordering. */
export function issueAnswerBills<T>(
  progressBills: T[],
  latestActionBills: T[],
  sort: IssueAnswerSortKey,
): T[] {
  const selected =
    sort === 'action' && latestActionBills.length > 0 ? latestActionBills : progressBills;
  return selected.slice(0, 5);
}

/** These are 2 different answerable routes: authorship and bills by status. */
export function issueAnswerFollowUps(topic: string) {
  const authored = `Who authored ${topic} bills?`;
  const passed = `Which ${topic} bills have passed?`;
  return [
    { label: authored, submit: authored },
    { label: passed, submit: passed },
  ];
}

/** The total names everything that matched. Search is useful only when the
 * five-card answer window leaves at least one matching bill undisplayed. */
export function issueAnswerHasMore(totalMatches: number, shownCount: number): boolean {
  return totalMatches > shownCount;
}
