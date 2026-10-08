/** A suggestion may omit apartment or ZIP+4 detail. Carry that detail only after
 * every supplied part of the base location agrees, never by a fuzzy name match. */
const unitPattern = /\b(?:apt|apartment|unit|suite|ste)\.?\s*#?\s*([\w-]+)|#\s*([\w-]+)/i;
const otherUnitPattern = /\b(?:floor|fl|building|bldg|room|rm)\.?\s*\w+/i;
const zip4Pattern = /\b(\d{5})-(\d{4})\b/;
const aliases: Record<string, string> = {
  STREET: 'ST',
  AVENUE: 'AVE',
  ROAD: 'RD',
  CIRCLE: 'CIR',
  DRIVE: 'DR',
  LANE: 'LN',
  COURT: 'CT',
  BOULEVARD: 'BLVD',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
  MINNESOTA: 'MN',
};
function tokens(value: string) {
  return (
    value
      .replace(/(?:^|[,;\s]+)(?:UNITED STATES(?: OF AMERICA)?|U\.?S\.?A?\.?)\s*$/i, '')
      .replace(zip4Pattern, '$1')
      .toUpperCase()
      .match(/[A-Z0-9-]+/g)
      ?.map((part) => aliases[part] ?? part) ?? []
  );
}
export function preserveSuggestedUnit(draft: string, suggestion: string): string | null {
  const unit = draft.match(unitPattern);
  const suggestedUnit = suggestion.match(unitPattern);
  const zip4 = draft.match(zip4Pattern);
  // Unrecognized apartment formats remain searchable as typed instead of losing detail.
  if (otherUnitPattern.test(draft)) return null;
  if ((!unit || suggestedUnit) && !zip4) return suggestion;
  const supplied = tokens(draft.replace(unit?.[0] ?? '', ' '));
  const proposed = tokens(suggestion.replace(suggestedUnit?.[0] ?? '', ' '));
  if (supplied.length < 3 || supplied.some((part, index) => part !== proposed[index])) return null;
  let preserved = suggestion;
  if (zip4 && !zip4Pattern.test(suggestion)) {
    const plainZip = new RegExp(`\\b${zip4[1]}\\b`);
    if (!plainZip.test(suggestion)) return null;
    preserved = preserved.replace(plainZip, zip4[0]);
  }
  if (unit && !suggestedUnit) {
    const comma = preserved.indexOf(',');
    preserved =
      comma < 0
        ? `${preserved}, ${unit[0]}`
        : `${preserved.slice(0, comma)}, ${unit[0]}${preserved.slice(comma)}`;
  }
  return preserved;
}
