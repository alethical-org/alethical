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
import type { PaymentUnderName } from './paymentsUnderName';

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

/** The React Query key for every payment under one printed name, shared with the
 *  page function so the first page it read seeds the app's list. */
export function paymentsUnderNameQueryKey(name: string, role: PaymentNameRole | null) {
  return ['payments-under-name', name, role] as const;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * One served row, whichever of the 3 downloads it came from, shaped from the
 * service's own JSON. Pure, and kept in this dependency-free module rather than
 * `data/api.ts` so the page function (which cannot load that react-native-importing
 * module) shapes a served row exactly as the app does, and rather than
 * `lib/paymentsUnderName.ts` so the row formatting that module holds stays with
 * its screens instead of in every reader's first download.
 */
export function paymentUnderName(
  row: Record<string, unknown>,
  role: PaymentNameRole,
): PaymentUnderName {
  const filed = {
    year: typeof row.year === 'number' && Number.isInteger(row.year) ? row.year : null,
    employer: text(row.employer),
    filerKind: text(row.filer_kind),
    recordNumber: typeof row.record_number === 'number' ? row.record_number : null,
  };
  if (role === 'contributor') {
    return {
      ...filed,
      filerName: text(row.recipient_name),
      filerRegistrationNumber: text(row.recipient_registration_number),
      filerEntityType: text(row.recipient_type),
      receiptType: text(row.receipt_type),
      purpose: null,
      expenditureType: null,
      affectedCommitteeName: null,
      stance: null,
      amount: text(row.amount),
      paidOn: text(row.received_on),
      inKind: text(row.in_kind),
    };
  }
  if (role === 'vendor') {
    return {
      ...filed,
      filerName: text(row.committee_name),
      filerRegistrationNumber: text(row.committee_registration_number),
      filerEntityType: null,
      receiptType: null,
      purpose: text(row.purpose),
      expenditureType: text(row.expenditure_type),
      affectedCommitteeName: null,
      stance: null,
      amount: text(row.amount),
      paidOn: text(row.paid_on),
      inKind: text(row.in_kind),
    };
  }
  return {
    ...filed,
    filerName: text(row.spender),
    filerRegistrationNumber: text(row.spender_registration_number),
    filerEntityType: null,
    receiptType: null,
    purpose: text(row.purpose),
    expenditureType: text(row.expenditure_type),
    affectedCommitteeName: text(row.affected_committee_name),
    stance: text(row.stance),
    amount: text(row.amount),
    paidOn: text(row.paid_on),
    // The independent-expenditures download carries no in-kind column at all.
    inKind: null,
  };
}
