import { moneyDetailsPageCopy } from './campaignMoneyDetailsPageCopy';

// Reader-facing wording belongs to the layout, never to a downloaded payment.
export const OUTSIDE_GROUP_COPY = {
  explainer:
    "Money that groups other than this legislator's campaign told the state they spent to support or oppose them. It never passes through their campaign, so their campaign's own reports do not show it.",
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
  // The Board's own row label on that page, read there on 13 Sep 2026. It also puts
  // the state's own term, independent expenditures, on a card that otherwise never
  // uses it, which is what a reader needs to search the Board's site. "its" is the
  // downloads page named on the line above, so the Board is not named twice in 2 lines.
  sourceFile: 'These figures come from its file “Itemized independent expenditures of over $200”',
  paymentMade: 'Payment made',
  paymentsMade: 'Payments made',
} as const;
