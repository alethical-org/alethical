import { describe, expect, it } from 'vitest';

import {
  ISSUE_ANSWER_SORT_OPTIONS,
  issueAnswerBills,
  issueAnswerFollowUps,
  issueAnswerHasMore,
  resolveIssueAnswerSort,
} from '../issueAnswer';

describe('issue answer list behavior', () => {
  it('defaults to progress and accepts only the 2 shipped choices', () => {
    expect(resolveIssueAnswerSort(undefined)).toBe('progress');
    expect(resolveIssueAnswerSort('action')).toBe('action');
    expect(resolveIssueAnswerSort('best')).toBe('progress');
    expect(ISSUE_ANSWER_SORT_OPTIONS).toEqual([
      { key: 'progress', label: 'Legislative progress' },
      { key: 'action', label: 'Latest action' },
    ]);
  });

  it('uses the server-ranked list and never shows more than 5 bills', () => {
    const progress = ['signed', 'both', 'one', 'committee', 'introduced', 'overflow'];
    const action = ['newest', 'newer', 'middle', 'older', 'oldest', 'overflow'];

    expect(issueAnswerBills(progress, action, 'progress')).toEqual(progress.slice(0, 5));
    expect(issueAnswerBills(progress, action, 'action')).toEqual(action.slice(0, 5));
    expect(issueAnswerBills(progress, [], 'action')).toEqual(progress.slice(0, 5));
  });

  it('offers 2 answerable follow-ups that ask different kinds of questions', () => {
    expect(issueAnswerFollowUps('affordable housing')).toEqual([
      {
        label: 'Who authored affordable housing bills?',
        submit: 'Who authored affordable housing bills?',
      },
      {
        label: 'Which affordable housing bills have passed?',
        submit: 'Which affordable housing bills have passed?',
      },
    ]);
  });

  it('shows the Search link only when some matching bills are not rendered', () => {
    expect(issueAnswerHasMore(18, 5)).toBe(true);
    expect(issueAnswerHasMore(3, 3)).toBe(false);
    expect(issueAnswerHasMore(0, 0)).toBe(false);
  });
});
