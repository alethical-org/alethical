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

/** The topic answer has a corpus freshness date rather than 1 bill's pull date.
 * It appears once, in the shared source line. */
export function issueAnswerUpdatedLabel(dataAsOf: string | undefined): string {
  const match = dataAsOf?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return `Updated ${formatted}`;
}
