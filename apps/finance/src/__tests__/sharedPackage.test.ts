import { describe, expect, it } from 'vitest';

import { formatMoney } from '@alethical/shared/moneyFormat';

// Finance takes alethical.com's display and wording modules only through
// @alethical/shared (docs/architecture/alethical-finance-architecture.md §2). This
// proves Finance's own build resolves the package and runs a real module from it.
describe('@alethical/shared', () => {
  it("formats money with alethical.com's own rule", () => {
    expect(formatMoney(178579449.67)).toBe('$178,579,449');
    expect(formatMoney(null)).toBeNull();
  });
});
