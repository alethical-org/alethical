/**
 * Join the confirmation card's optional unit into the street address the reader
 * confirmed, as 1 visible and submitted address. The official matcher decides
 * whether the unit is supported; this never drops, replaces or guesses a unit.
 */
const UNIT = /(?:\b(?:apt|apartment|unit|suite|ste)\.?\s+|#\s*)[a-z0-9-]+\b/gi;
const STATE_AND_ZIP = /(?:,?\s+(?:mn|minnesota))?,?\s+\d{5}(?:-\d{4})?\s*$/i;

function comparable(unit: string) {
  return unit.toUpperCase().replace(/\./g, '').replace(/#\s*/, '#').replace(/\s+/g, ' ').trim();
}

/** A bare value such as `3` states only a number, so it becomes `#3`. */
export function normalizeAddressUnit(value: string) {
  const unit = value.trim().replace(/\s+/g, ' ');
  if (!unit) return '';
  if (/^[a-z0-9-]+$/i.test(unit)) return `#${unit}`;
  return unit.replace(/^#\s*/, '#');
}

export function joinAddressUnit(street: string, unitValue: string) {
  const address = street.trim().replace(/\s+/g, ' ');
  const unit = normalizeAddressUnit(unitValue);
  if (!unit) return address;
  const present = address.match(UNIT) ?? [];
  // The same unit typed in both fields appears once. A different one is kept, and
  // the official match then refuses the address instead of choosing either unit.
  if (present.length === 1 && comparable(present[0]) === comparable(unit)) return address;
  const comma = address.indexOf(',');
  if (comma >= 0) return `${address.slice(0, comma)} ${unit}${address.slice(comma)}`;
  const tail = address.match(STATE_AND_ZIP);
  if (tail?.index) return `${address.slice(0, tail.index)} ${unit}${address.slice(tail.index)}`;
  return `${address} ${unit}`;
}
