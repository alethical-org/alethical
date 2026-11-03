import { setNegativeSign } from '@alethical/shared/moneyFormat';

/**
 * Finance prints every negative figure with the true minus sign ("−$150"), as
 * its design system draws it, including figures formatted inside the shared
 * helpers it takes from the public site. Imported first by main.tsx; the public
 * site never sets it, so it keeps the hyphen.
 */
setNegativeSign('minus');
