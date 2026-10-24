import { PUBLIC_SITE_ORIGIN } from './share';

/** One public identity for the publisher across pages and articles. */
export const ORGANIZATION_ID = `${PUBLIC_SITE_ORIGIN}/#organization`;
export const ORGANIZATION_REFERENCE = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Alethical',
  url: `${PUBLIC_SITE_ORIGIN}/`,
};
