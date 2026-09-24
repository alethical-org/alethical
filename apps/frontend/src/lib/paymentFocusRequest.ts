/**
 * A notice asking the payment list to open and focus the payment it matches (#2347).
 *
 * The notices card and the payment list are separate parts of the committee page, and
 * the list keeps which rows are open to itself. This is the one channel between them: a
 * matched notice's link asks for a payment by its tab, its donor group and its record
 * number, and the list, which is the only part that knows how it is drawn, selects the
 * tab, opens the row and moves focus to the payment.
 */
export interface PaymentFocusRequest {
  tab: string;
  groupKey: string;
  recordNumber: number;
}

type Listener = (request: PaymentFocusRequest) => void;
const listeners = new Set<Listener>();

export function requestPaymentFocus(request: PaymentFocusRequest): boolean {
  for (const listener of listeners) listener(request);
  return listeners.size > 0;
}

export function onPaymentFocusRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The payment's own element id, so focus lands on the one payment the notice names. */
export function paymentElementId(recordNumber: number): string {
  return `payment-record-${recordNumber}`;
}
