/** The standalone committee-payments view's words and rows, shared with its first served HTML. */
import { formatDay, formatMoney } from './legislatorCampaignMoney';
import {
  committeeSlug,
  isInKind,
  UNNAMED_PAYMENT_PARTY,
  PAGE_CAP,
  type PaymentsTab,
} from './committeeMoneyShared';

/** Which direction of the payments file a tab reads. */
export function paymentsDirection(tab: PaymentsTab): 'received' | 'made' {
  return tab === 'gave' ? 'received' : 'made';
}

export function paymentsTitle(tab: PaymentsTab): string {
  return tab === 'gave' ? 'Who gave to this committee' : 'Where this committee’s money went';
}

export function paymentsEyebrow(tab: PaymentsTab): string {
  return tab === 'gave' ? 'Every donor named' : 'Every payment named';
}

export const PAYMENTS_TAB_LABELS: Record<PaymentsTab, string> = {
  gave: 'Who gave',
  spent: 'Where it went',
};

/** A failed read is our gap, never evidence that the filing names nobody. */
export const PAYMENTS_LOAD_ERROR =
  'We couldn’t load these payments right now. This is a problem on our side and ' +
  'says nothing about the committee. Please try again in a moment.';

export function paymentsUnavailable(state: string | null | undefined): boolean {
  return state !== 'reported' && state !== 'not_reported';
}

/** "Showing 250 of 1,284 payments named" / "41 payments named in this period". */
export function showingLine(shown: number, total: number | null): string | null {
  if (total === null) return null;
  if (shown < total) {
    return `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} payments named`;
  }
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'payment' : 'payments'} named in this period`;
}

/** The cap is ours, not the filing's, and the card says so in those words. */
export const CAP_NOTE =
  'We load 50 first, then up to 250 at a time, largest first — the cap is ours, not the filing’s. The ' +
  'reports these payments come from list every one of them, and they are public.';

export function capNextLabel(shown: number, total: number): string {
  const next = Math.min(PAGE_CAP, total - shown);
  return `Show the next ${next.toLocaleString('en-US')}`;
}

/**
 * Linked held registration numbers open committee records; other linked names open
 * exact-spelling payment records, never a person or business profile. Names without
 * a supported destination stay unlinked. The threshold clause is left off a
 * ballot-question committee's page entirely (rule 12, as amended).
 */
export function listLinkNote(tab: PaymentsTab, isBallot: boolean): string {
  const opens =
    'A linked committee name opens its registered committee’s page. Other linked names open ' +
    'payments filed under that exact spelling. A name alone does not identify a person or business.';
  if (isBallot) return opens;
  const threshold =
    tab === 'gave'
      ? ' Minnesota makes a committee name a donor only once that donor has given more than $200 in total for the year, so these payments never sum to the total on the committee’s page.'
      : ' Minnesota makes a committee name a recipient only once payments to them pass $200 in total for the year, so these payments never sum to the total on the committee’s page.';
  return opens + threshold;
}

/** The empty payments list for a year nothing covers. */
export function emptyListTitle(tab: PaymentsTab, year: number): string {
  return tab === 'gave' ? `No donors named for ${year}` : `No payments named for ${year}`;
}

export function emptyListWhy(year: number): string {
  return (
    `Payments are listed from the reports that cover them, and the state’s files we ` +
    `hold name none for ${year} for this committee. Earlier years’ payments are on ` +
    `their own year’s view — we do not show them under a ${year} heading.`
  );
}

export type ReceivedPaymentLike = {
  contributorType: string | null;
  receiptType: string | null;
  inKind: string | null;
};

export type MadePaymentLike = {
  expenditureType: string | null;
  purpose: string | null;
  vendorCity: string | null;
  vendorState: string | null;
  inKind: string | null;
};

/**
 * The grey line under a donor's name: the filing's own type, plus the schedule
 * label when the money is not a donation — a loan listed under "who gave" without
 * its label would read as a gift. The download carries no city or occupation for a
 * donor, so the row states only what the filing states.
 */
export function receivedRowMeta(payment: ReceivedPaymentLike): string {
  const parts: string[] = [];
  if (payment.contributorType) parts.push(payment.contributorType);
  if (payment.receiptType && payment.receiptType !== 'Contribution') {
    parts.push(`${payment.receiptType} — reported on its own schedule, not a donation`);
  }
  return parts.join(' · ');
}

/** The grey line under a payee's name: the plain transfer label for money given to
 *  another campaign, otherwise the filing's own purpose and the vendor's city. */
export function madeRowMeta(payment: MadePaymentLike): string {
  const parts: string[] = [];
  if (payment.expenditureType === 'Contribution') {
    parts.push('Money given to another campaign');
  }
  if (payment.purpose) parts.push(payment.purpose);
  const place = [payment.vendorCity, payment.vendorState].filter(Boolean).join(', ');
  if (place) parts.push(place);
  return parts.join(' · ');
}

/** What a payments row shows, whichever direction it came from. */
export interface PaymentRow {
  /** The filing's own name for the other side, or the plain stand-in below. */
  name: string;
  meta: string;
  /** "Jul 20, 2026", or null when the filing carries no date for the payment. */
  date: string | null;
  /** "$1,250.00", or null when the filing carries no readable amount. */
  amount: string | null;
  inKind: boolean;
  /** Set only when the other side is a filer whose own page we can open. */
  linkNumber: string | null;
  linkName: string | null;
  /**
   * Set only when the other side is NOT a registered filer but IS a printed name
   * we can look up under that exact spelling (#1331). A registered filer takes
   * ``linkNumber`` instead, because a registration number identifies a committee
   * and a name does not.
   */
  nameLink: PaymentNameLink | null;
}

/**
 * Where a printed name links to, and it is a SPELLING rather than a person.
 *
 * Minnesota's filings carry no identifier for a person, an employer or a vendor,
 * so the printed string is the whole of the key. Eugene ruled on 1 Sep 2026 that
 * 2 spellings are joined only when they are identical, character for character
 * ([#1331](https://github.com/alethical-org/alethical/issues/1331)): "Messinger,
 * Alida" and "Messinger, Alida R" stay 2 keys. The rule can only under-report,
 * and it can never invent a link between 2 real people, which is the failure
 * `.claude/rules/grounded-answers.md` rule 3 forbids.
 *
 * The destination already carries that limit in its own words: the name page
 * quotes the string it searched for and says nothing is joined, so it cannot be
 * read as a profile. This type only decides which rows reach it.
 */
export interface PaymentNameLink {
  /** Which column the name was printed in, which is what the lookup keys on. */
  role: 'contributor' | 'vendor';
  /** The filing's own spelling, passed through untouched. */
  name: string;
}

/**
 * The printed name a row can be looked up under, or null when it cannot.
 *
 * Three rows deliberately do not link, and each would be a false claim rather
 * than a missing convenience:
 *
 * - **A registered filer.** It links by registration number instead, so a name
 *   match can never attribute money to the wrong committee (#1331's first
 *   acceptance criterion).
 * - **A filing that names nobody.** The row displays ``UNNAMED_PAYMENT_PARTY``,
 *   our own sentence rather than anything a filing printed, but this function is
 *   handed the filing's raw field, so a nameless payment arrives here as null or
 *   blank and the emptiness check below is what stops it. Comparing against the
 *   placeholder string as well was tried and removed: no caller can produce it,
 *   so a mutation test could not falsify it, and an unfalsifiable line in a
 *   correctness guard reads as protection that is not there.
 * - **A committee named on a transfer out.** Where a payment out is a transfer,
 *   the row shows the receiving committee's name rather than the vendor field,
 *   so looking that string up in the VENDOR column asks the wrong question.
 */
/**
 * One payment row's destination, or nothing, as an address.
 *
 * Lives here rather than in the screen or the snapshot because those 2 must
 * offer the SAME destinations: the interactive page and the first response a
 * search engine reads are the same page, and a link present in one and absent
 * from the other is a page that changes under the reader (#1812).
 */
export function paymentRowHref(row: PaymentRow): string | undefined {
  if (row.linkNumber && row.linkName) {
    return `/money/committees/${encodeURIComponent(committeeSlug(row.linkName, row.linkNumber))}`;
  }
  if (row.nameLink) {
    // Built to match `pathForRoute`'s own output for PaymentsUnderName rather
    // than imported from it, because the navigation module imports from here and
    // the snapshot already hand-builds the committee address the same way. The
    // test below pins the 2 against each other so a change to either fails.
    const params = new URLSearchParams({
      name: row.nameLink.name,
      role: row.nameLink.role,
    });
    return `/money/payments?${params.toString()}`;
  }
  return undefined;
}

function nameLinkFor(
  role: PaymentNameLink['role'],
  printed: string | null,
  registrationNumber: string | null,
): PaymentNameLink | null {
  if (registrationNumber) return null;
  const name = printed?.trim() ?? '';
  if (!name) return null;
  return { role, name };
}

/**
 * One donation as a row. Shared by the full-payments screen and by the text the
 * first server response carries (#1812), so the served line and the drawn line
 * are the same characters rather than 2 similar sentences.
 */
export function receivedPaymentRow(
  payment: {
    contributor: string | null;
    contributorRegistrationNumber: string | null;
    contributorType: string | null;
    amount: string | null;
    receivedOn: string | null;
    receiptType: string | null;
    inKind: string | null;
  },
  linkable: ReadonlySet<string>,
): PaymentRow {
  return {
    name: payment.contributor ?? UNNAMED_PAYMENT_PARTY,
    meta: receivedRowMeta(payment),
    date: formatDay(payment.receivedOn),
    amount: formatMoney(payment.amount),
    inKind: isInKind(payment.inKind),
    linkNumber:
      payment.contributorRegistrationNumber && linkable.has(payment.contributorRegistrationNumber)
        ? payment.contributorRegistrationNumber
        : null,
    linkName: payment.contributor,
    // Keyed on the registration number rather than on `linkable`: a donor the
    // register knows is a filer whose own page is the honest destination, even
    // where we hold no page for it yet, so it must not fall through to a
    // spelling lookup.
    nameLink: nameLinkFor(
      'contributor',
      payment.contributor,
      payment.contributorRegistrationNumber,
    ),
  };
}

/**
 * One payment out as a row. Money given to another campaign is named by the
 * committee it reached rather than by the vendor field, because that is the fact
 * the filing records; everything else keeps the vendor's own name.
 */
export function madePaymentRow(
  payment: {
    vendorName: string | null;
    vendorCity: string | null;
    vendorState: string | null;
    affectedCommitteeName: string | null;
    affectedCommitteeRegistrationNumber: string | null;
    amount: string | null;
    paidOn: string | null;
    expenditureType: string | null;
    purpose: string | null;
    inKind: string | null;
  },
  linkable: ReadonlySet<string>,
): PaymentRow {
  const isTransfer = payment.expenditureType === 'Contribution';
  return {
    name:
      (isTransfer ? (payment.affectedCommitteeName ?? payment.vendorName) : payment.vendorName) ??
      UNNAMED_PAYMENT_PARTY,
    meta: madeRowMeta(payment),
    date: formatDay(payment.paidOn),
    amount: formatMoney(payment.amount),
    inKind: isInKind(payment.inKind),
    linkNumber:
      payment.affectedCommitteeRegistrationNumber &&
      linkable.has(payment.affectedCommitteeRegistrationNumber)
        ? payment.affectedCommitteeRegistrationNumber
        : null,
    linkName: payment.affectedCommitteeName,
    // A transfer shows the RECEIVING COMMITTEE's name, not the vendor field, so
    // that string must never reach a vendor-column lookup: passing null keeps it
    // plain text. Everything else is a real vendor and links under its spelling.
    nameLink: isTransfer
      ? null
      : nameLinkFor('vendor', payment.vendorName, payment.affectedCommitteeRegistrationNumber),
  };
}
