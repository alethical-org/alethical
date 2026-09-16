import { moneyDetailsPageCopy } from './campaignMoneyDetailsPageCopy';

// Reader-facing wording belongs to the layout, never to a downloaded payment.
export const OUTSIDE_GROUP_COPY = {
  explainer:
    "Independent expenditures are money outside groups reported spending to support or oppose this candidate. This money does not go to the candidate's campaign.",
  heading: 'Who spent',
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
  // The Board's own row label; the source line also draws when no figures do.
  sourceFile: 'Source file: “Itemized independent expenditures of over $200”',
  paymentMade: 'Payment made',
  paymentsMade: 'Payments made',
} as const;
