import { AuthClient } from '@supabase/auth-js';

import { buildTemporaryAuthClientOptions } from './linkSession';

/**
 * A separate sign-in client that cannot inspect or replace the ordinary saved
 * session.
 *
 * Alone in its own file because constructing an `AuthClient` is what pulls
 * `@supabase/auth-js` — 122,714 minified bytes — into whatever download reaches
 * it, and only the sign-in screens ever build one
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)). Its
 * options, which are plain values, stay in `lib/auth/linkSession.ts` beside the
 * rules that shape them.
 */
export function createTemporaryAuthClient(
  supabaseUrl: string,
  publishableKey: string,
): InstanceType<typeof AuthClient> {
  return new AuthClient(buildTemporaryAuthClientOptions(supabaseUrl, publishableKey));
}
