import type { PageMetadata } from './share';

/** Only source identity belongs in lobbying record search/share labels. */
export function lobbyingPageMetadata(
  path: string,
  name: string,
  options: {
    kind?: 'directory' | 'principal' | 'lobbyist';
    page?: number;
    noindex?: boolean;
  } = {},
): PageMetadata {
  const subject =
    options.kind === 'directory'
      ? `${name}${options.page && options.page > 1 ? ` — page ${options.page}` : ''} — lobbying`
      : options.kind === 'principal'
        ? `${name} — Lobbying principal`
        : options.kind === 'lobbyist'
          ? `${name} — Minnesota lobbyist`
          : name;
  return {
    title: `${subject} | Alethical`,
    socialTitle: subject,
    description: `${name}: Minnesota Campaign Finance and Public Disclosure Board lobbying records`,
    canonicalPath: options.noindex ? '' : path,
    noindex: options.noindex ?? false,
  };
}
