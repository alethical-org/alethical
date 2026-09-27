/** A fragment belongs to the article named by the current address, never the previous article. */
export function articleOpeningSection(
  pathname: string,
  articlePath: string,
  hash: string,
  anchors: readonly string[],
): string | null {
  const anchor = hash.replace(/^#/, '');
  return pathname === articlePath && anchors.includes(anchor) ? anchor : null;
}
