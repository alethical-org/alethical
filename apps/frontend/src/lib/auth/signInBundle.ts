/**
 * Everything sign-in, in one download.
 *
 * Nothing imports this file directly. `lib/auth/loadSignInBundle.ts` is the only
 * way in, so the sign-in client, the dialog, the fields and the email-link page
 * all arrive together in a single piece rather than in pieces that overlap.
 *
 * **One piece is the point, not a convenience.** The web build puts anything
 * 2 downloadable pieces both need into a shared file that every page fetches, so
 * splitting sign-in in half would put its shared middle — including the 122,714
 * minified bytes of `@supabase/auth-js` — straight back into every reader's first
 * load, which is what
 * [#1976](https://github.com/alethical-org/alethical/issues/1976) exists to
 * remove.
 *
 * The cost, accepted: a reader who IS signed in fetches the dialog along with the
 * client that restores their session, because both live here. They pay it after
 * the page can draw rather than before, and they are the reader most likely to
 * open the dialog next.
 */

export {
  AccountAvatarButton,
  AccountDrawerRow,
  AccountNavButton,
} from '../../components/auth/AccountControl';
export { SignInMachinery } from '../../providers/SignInMachinery';
export { EmailLinkPage } from '../../screens/auth/EmailLinkPage';
export {
  clearOrdinarySessionIfUnchanged,
  clearStoredSupabaseSession,
  passwordClientForOrdinarySession,
  setOrdinarySessionIfUnchanged,
  signOutOrdinarySessionIfUnchanged,
  supabase,
} from '../supabase';
