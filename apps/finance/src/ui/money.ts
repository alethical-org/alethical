import { formatMoney as sharedFormatMoney } from '@alethical/shared/moneyFormat';

export * from '@alethical/shared/moneyFormat';

/**
 * Finance's money formatter: the public site's shared formatter with the true minus
 * sign on a negative figure ("−$150"), as Finance's design system draws it. Every
 * Finance figure goes through this, so the 1 difference lives in 1 place.
 */
export function formatMoney(value: number | string | null | undefined): string | null {
  return sharedFormatMoney(value, { minusSign: true });
}
