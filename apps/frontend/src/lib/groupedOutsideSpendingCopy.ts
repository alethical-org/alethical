import { moneyDetailsPageCopy } from './campaignMoneyDetailsPageCopy';

// Reader-facing wording belongs to the layout, never to a downloaded payment.
export const OUTSIDE_GROUP_COPY = {
  explainer:
    "Money that groups other than this legislator's campaign have told the state they spent to support or oppose them. It does not go to their campaign and appears nowhere in the reports their campaign files, so reading only those reports leaves this money out.",
  heading: 'Who spent it',
  loading: moneyDetailsPageCopy.outsideLoading,
  failed:
    'We could not load the list of outside spenders right now. The figures above still come from the saved state file.',
  detailsLoading: 'Loading all the payments…',
  detailsFailed:
    'We could not load the complete payment details from the same state file. The amount above still comes from the complete spender list.',
  retry: 'Try again',
  unknownName: 'Name not given in the filing',
  unknownAmount: 'Amount not given in the filing',
  unknownDate: 'Date not given in the filing',
  unknownPurpose: 'Purpose not given in the filing',
  unknownVendor: 'Vendor not given in the filing',
  exactName: 'Registration not given; grouped by name as filed',
  source: 'Minnesota Campaign Finance Board filings',
  paymentMade: 'Payment made',
  paymentsMade: 'Payments made',
} as const;
