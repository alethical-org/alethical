/** Exact signed-out Home introduction used before and after the app starts. */
export const HOME_PUBLIC_INTRO =
  'We read every bill so you don’t have to — what it says, where it stands, and how legislators voted. And the money: who gives, who spends, who gets paid, and who lobbies. Plain language, with every claim linked to the official record.';

/** The 2 bill-group exits and the exact Bill Search state they promise. */
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
