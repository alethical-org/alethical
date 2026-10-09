/**
 * Join the confirmation card's optional unit into the street address the reader
 * confirmed, as 1 visible and submitted address. The official matcher decides
 * whether the unit is supported; this never drops, replaces or guesses a unit.
 */
// Matches the service's unit spellings, including "Apt.250".
const UNIT = /(?:\b(?:apt|apartment|unit|suite|ste)(?:\.\s*|\s+)|#\s*)[a-z0-9-]+\b/gi;
const STATE_AND_ZIP = /(?:,?\s+(?:mn|minnesota))?,?\s+\d{5}(?:-\d{4})?\s*$/i;

function comparable(unit: string) {
  return unit
    .toUpperCase()
    .replace(/^(APT|APARTMENT|UNIT|SUITE|STE)\.\s*/, '$1 ')
    .replace(/\./g, '')
    .replace(/#\s*/, '#')
    .replace(/\s+/g, ' ')
    .trim();
}
const identifier = (unit: string) => comparable(unit).replace(/^(?:[A-Z]+ |#)/, '');

/** A bare value such as `3` states only a number, so it becomes `#3`. */
export function normalizeAddressUnit(value: string) {
  const unit = value.trim().replace(/\s+/g, ' ');
  if (!unit) return '';
  if (/^[a-z0-9-]+$/i.test(unit)) return `#${unit}`;
  // "Apt. 3" and "Apt 3" are the same label to the official match.
  return unit.replace(/^#\s*/, '#').replace(/^(apt|apartment|unit|suite|ste)\.\s*/i, '$1 ');
}

export function joinAddressUnit(street: string, unitValue: string) {
  const address = street.trim().replace(/\s+/g, ' ');
  const unit = normalizeAddressUnit(unitValue);
  if (!unit) return address;
  const present = address.match(UNIT) ?? [];
  // The same unit typed in both fields appears once. A different one is kept, and
  // the official match then refuses the address instead of choosing either unit.
  const bare = /^#/.test(unit) && /^[a-z0-9-]+$/i.test(unitValue.trim().replace(/^#\s*/, ''));
  if (
    present.length === 1 &&
    (comparable(present[0]) === comparable(unit) ||
      // A bare `3` beside "Apt 3" already in the street names the same unit.
      (bare && identifier(present[0]) === identifier(unit)))
  )
    return address;
  const comma = address.indexOf(',');
  if (comma >= 0) return `${address.slice(0, comma)} ${unit}${address.slice(comma)}`;
  const tail = address.match(STATE_AND_ZIP);
  if (tail?.index) return `${address.slice(0, tail.index)} ${unit}${address.slice(tail.index)}`;
  return `${address} ${unit}`;
}
