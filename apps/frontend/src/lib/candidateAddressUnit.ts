/**
 * Join the confirmation card's optional unit into the street address the reader
 * confirmed, as 1 visible and submitted address. The official matcher decides
 * whether the unit is supported; this never drops, replaces or guesses a unit.
 */
// Matches the service's unit spellings, including "Apt.250" and "Apt #250".
const UNIT = /(?:\b(?:apt|apartment|unit|suite|ste)(?:\.\s*|\s+)(?:#\s*)?|#\s*)[a-z0-9-]+\b/gi;
const STATE_AND_ZIP = /(?:,?\s+(?:mn|minnesota))?,?\s+\d{5}(?:-\d{4})?\s*$/i;

// The service's whole single-unit grammar: 1 optional supported label and 1 value.
const ONE_UNIT =
  /^(?:(apt|apartment|unit|suite|ste)(?:\.\s*|\s+)(?:#\s*)?|#\s*)?([a-z0-9][a-z0-9-]*)$/i;

function parseUnit(text: string) {
  const match = text.trim().replace(/\s+/g, ' ').match(ONE_UNIT);
  return match && { label: match[1]?.toUpperCase(), value: match[2].toUpperCase() };
}

/**
 * True only when both are complete supported units with the same value and either the
 * same label or no label on 1 side ("#250" or a bare "250" states only the number).
 * Anything else, including punctuation inside a value, is never treated as the same.
 */
function sameUnit(a: string, b: string) {
  const first = parseUnit(a);
  const second = parseUnit(b);
  return (
    !!first &&
    !!second &&
    first.value === second.value &&
    (first.label === second.label || !first.label || !second.label)
  );
}

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
  const present = [...address.matchAll(UNIT)];
  // The same unit typed in both fields appears once. A different one is kept, and
  // the official match then refuses the address instead of choosing either unit.
  // The street's unit counts only when it ends at a comma, the state and ZIP or the
  // end, so text after it ("Apt #250.5", "Apt #250 rear") is never ignored.
  if (present.length === 1 && sameUnit(present[0][0], unit)) {
    const rest = address.slice(present[0].index + present[0][0].length);
    if (/^\s*(?:,|$)/.test(rest) || rest.match(STATE_AND_ZIP)?.index === 0) return address;
  }
  const comma = address.indexOf(',');
  if (comma >= 0) return `${address.slice(0, comma)} ${unit}${address.slice(comma)}`;
  const tail = address.match(STATE_AND_ZIP);
  if (tail?.index) return `${address.slice(0, tail.index)} ${unit}${address.slice(tail.index)}`;
  return `${address} ${unit}`;
}
