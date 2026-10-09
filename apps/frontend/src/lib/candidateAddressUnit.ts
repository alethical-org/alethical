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
 * True only when both are complete supported units with the same value, and the card
 * either repeats the street's label or states only the number ("#250" or a bare "250").
 * A labelled card unit beside a street unit with no label is kept, because a word
 * before the street's "#" ("Floor #250") may be a label the service does not accept.
 * Anything else, including punctuation inside a value, is never treated as the same.
 */
function sameUnit(street: string, card: string) {
  const inStreet = parseUnit(street);
  const inCard = parseUnit(card);
  return (
    !!inStreet &&
    !!inCard &&
    inStreet.value === inCard.value &&
    (inStreet.label === inCard.label || !inCard.label)
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
  // The street's unit counts only as a whole word that ends at a comma, the state and
  // ZIP or the end, so text around it ("Unit#250", "Apt #250.5", "Apt #250 rear") is
  // never ignored.
  if (present.length === 1 && sameUnit(present[0][0], unit)) {
    const start = present[0].index;
    const rest = address.slice(start + present[0][0].length);
    const wholeWord = start === 0 || /[\s,]/.test(address[start - 1]);
    if (wholeWord && (/^\s*(?:,|$)/.test(rest) || rest.match(STATE_AND_ZIP)?.index === 0))
      return address;
  }
  const comma = address.indexOf(',');
  if (comma >= 0) return `${address.slice(0, comma)} ${unit}${address.slice(comma)}`;
  const tail = address.match(STATE_AND_ZIP);
  if (tail?.index) return `${address.slice(0, tail.index)} ${unit}${address.slice(tail.index)}`;
  return `${address} ${unit}`;
}
