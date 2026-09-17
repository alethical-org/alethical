/** Address validation, share heading and request size needed before a payment screen loads. */
/**
 * The 3 roles this page answers for. They are the server's own `role` values,
 * verbatim, and they are exactly the 3 the name search emits on its rows, so a
 * result row opens its payments without translating anything.
 *
 * The server serves a 4th, `employer` — payments whose donor typed this string in
 * the employer box. Nothing links to it and this page does not accept it: that
 * column is free text holding statuses and occupations as much as employers (its
 * commonest values are "Not Employed" and "Retired"), so it needs wording of its
 * own that says it is never a company's giving, and no surface asks for it yet.
 */
export const PAYMENT_NAME_ROLES = ['contributor', 'vendor', 'independent_vendor'] as const;

export type PaymentNameRole = (typeof PAYMENT_NAME_ROLES)[number];

/** The role out of an address, or null when it is one we do not serve. A role we
 *  do not answer for is a page that does not exist, never a silent fallback to a
 *  different question. */
export function paymentNameRole(value: string | null | undefined): PaymentNameRole | null {
  return PAYMENT_NAME_ROLES.includes(value as PaymentNameRole) ? (value as PaymentNameRole) : null;
}

/**
 * The heading. The spelling is quoted and the words in front of it say what the
 * page is, so neither a reader nor a screen reader can take the page for a
 * profile of whoever or whatever carries that name — the same discipline the
 * search page's own heading follows.
 */
export function paymentsUnderNameHeading(name: string, role: PaymentNameRole): string {
  const quoted = `“${name}”`;
  if (role === 'contributor') return `Money given under the name ${quoted}`;
  if (role === 'vendor') return `Money paid under the name ${quoted}`;
  return `Independent spending paid under the name ${quoted}`;
}

/**
 * How many rows one request asks for. 250 is the server's own maximum for a page
 * of payments, so one press of the cap button is one request.
 */
export const PAYMENTS_UNDER_NAME_PAGE_SIZE = 250;
