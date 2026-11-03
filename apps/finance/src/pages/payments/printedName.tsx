/**
 * A printed spelling exactly as filed. Each source spelling is its own key, so one
 * with spaces around it (" Target ") must read differently from its neighbours
 * ("Target", "Target "): it prints in visible quotes with its spaces kept
 * (settled wording row 63). Any other spelling prints as it is.
 */
export function hasStraySpaces(name: string): boolean {
  return name !== name.trim();
}

/** The spelling as text, quoted when it has spaces around it. */
export function quotedSpelling(name: string): string {
  return hasStraySpaces(name) ? `“${name}”` : name;
}

export function PrintedName({ name }: { name: string }) {
  if (!hasStraySpaces(name)) return <>{name}</>;
  return <span style={{ whiteSpace: 'pre-wrap' }}>{quotedSpelling(name)}</span>;
}
