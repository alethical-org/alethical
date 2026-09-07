import { loadSignInBundle } from '../../lib/auth/loadSignInBundle';
import { loadOnDemand } from '../../lib/loadOnDemand';

/**
 * The top bar's account controls, fetched with the rest of sign-in rather than
 * carried by every page ([#1976](https://github.com/alethical-org/alethical/issues/1976)).
 *
 * **This costs a signed-in reader nothing**, which is why it is safe. The bar
 * draws these only when somebody is signed in, and the app cannot know that until
 * the sign-in client has read the saved session — so by the time one of these is
 * asked for, the download it lives in is already in hand and the control appears
 * with it. A reader who is not signed in sees a Sign in button and fetches none of
 * it: the account menu, the password dialog and the fields behind them are about
 * 82,000 source bytes.
 */

/** Desktop top nav: avatar + first name + chevron, opening a right-aligned menu. */
export const AccountNavButton = loadOnDemand(() =>
  loadSignInBundle().then((bundle) => ({ default: bundle.AccountNavButton })),
);

/** Phone top bar: a 44x44 avatar target that opens the account sheet. */
export const AccountAvatarButton = loadOnDemand(() =>
  loadSignInBundle().then((bundle) => ({ default: bundle.AccountAvatarButton })),
);

/** Phone drawer footer: a full-width account target opening the same account sheet. */
export const AccountDrawerRow = loadOnDemand(() =>
  loadSignInBundle().then((bundle) => ({ default: bundle.AccountDrawerRow })),
);
