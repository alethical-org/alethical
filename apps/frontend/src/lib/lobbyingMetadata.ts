import type { PageMetadata } from './share';

/**
 * Titles and descriptions for every lobbying page. The title names the record
 * and the state, so "Kozak, Andrew — Minnesota lobbyist" is unambiguous in a
 * result list; the description says what the page shows and where the records
 * come from, and it never repeats the name the title already carries or states
 * a figure the page would need a date beside (decisions doc §3).
 */
const DESCRIPTIONS = {
  landing:
    'Registered lobbyists, the organisations they represent, and what those organisations report spending on lobbying in Minnesota, from the Campaign Finance and Public Disclosure Board.',
  principals:
    'Every organisation registered as a lobbying principal in Minnesota, A to Z, each with the latest year it reported lobbying spending, from the Campaign Finance and Public Disclosure Board.',
  lobbyists:
    'Browse Minnesota’s copied lobbyist registration list by name or recorded campaign donations for a completed year, from the Campaign Finance and Public Disclosure Board.',
  principal:
    'Lobbying spending reported by year, and the lobbyists registered to represent this organisation, from Minnesota’s Campaign Finance and Public Disclosure Board.',
  lobbyist:
    'The organisations this lobbyist is registered to represent, and any campaign donations filed under the same registration number, from Minnesota’s Campaign Finance and Public Disclosure Board.',
} as const;

export function lobbyingPageMetadata(
  path: string,
  name: string,
  options: {
    kind?: 'directory' | 'principal' | 'lobbyist';
    page?: number;
    noindex?: boolean;
  } = {},
): PageMetadata {
  const pageSuffix = options.page && options.page > 1 ? ` — page ${options.page}` : '';
  const subject =
    options.kind === 'directory'
      ? `${name}${pageSuffix} — Minnesota lobbying`
      : options.kind === 'principal'
        ? `${name} — Minnesota lobbying principal`
        : options.kind === 'lobbyist'
          ? `${name} — Minnesota lobbyist`
          : `${name} in Minnesota`;
  const description =
    options.kind === 'directory'
      ? (name.toLowerCase() === 'lobbyists' ? DESCRIPTIONS.lobbyists : DESCRIPTIONS.principals) +
        (options.page && options.page > 1 ? ` Page ${options.page}.` : '')
      : options.kind === 'principal'
        ? DESCRIPTIONS.principal
        : options.kind === 'lobbyist'
          ? DESCRIPTIONS.lobbyist
          : DESCRIPTIONS.landing;
  return {
    title: `${subject} | Alethical`,
    socialTitle: subject,
    description,
    canonicalPath: options.noindex ? '' : path,
    noindex: options.noindex ?? false,
  };
}
