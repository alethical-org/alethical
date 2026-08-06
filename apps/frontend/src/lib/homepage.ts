/** The 2 desktop bill-group exits and the exact Bill Search state they promise. */
export const HOME_BILL_GROUP_CONTINUATIONS = {
  passed: {
    label: 'See more recently passed',
    params: { status: 'signed_into_law', sort: 'action' },
  },
  introduced: {
    label: 'See more recently introduced',
    params: { sort: 'introduced' },
  },
} as const;
