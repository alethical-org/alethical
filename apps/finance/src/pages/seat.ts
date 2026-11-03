/** The office and where it sits, each fact once, shared by People, Candidate and Legislator. */
const NOT_SIGNIFICANT = new Set(['district', 'member']);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The office and where it sits, each fact once (People drawing: "State
 * Representative, District 99A"). The server sends the office title ("State
 * Representative District 56A", "School Board Member (ISD #272)") and a voting
 * area that often repeats part of it ("House District 56A", "ISD #272 · Whole
 * district"). The office keeps its own words; an area part is added only for
 * what the office does not already say.
 */
export function seatParts(office?: string, area?: string): string[] {
  const original = office?.trim() ?? '';
  // The area's parts, without the seat count ("(Elect 2)") and without a part
  // that just restates the office.
  const parts = (area ?? '')
    .split('·')
    .map((part) => part.replace(/\(Elect \d+\)/g, '').trim())
    .map((part) =>
      original && part.startsWith(original) ? part.slice(original.length).trim() : part,
    )
    // "House District 56A" says no more than the office's "District 56A".
    .map((part) =>
      original
        ? part.replace(/^(House|Senate|Congressional|Judicial)\s+(?=District\b)/i, '')
        : part,
    )
    .filter(Boolean);
  const areaText = parts.join(' ').toLowerCase();
  // An office's parenthesis the area repeats ("(ISD #272)") is said by the area.
  const title = original
    .replace(/\s*\(([^)]*)\)/g, (whole, inner: string) =>
      areaText.includes(inner.trim().toLowerCase()) ? '' : whole,
    )
    .trim();
  const split = /^(.*\S)\s+(District\s+\S+)$/i.exec(title);
  const printed = split ? [split[1], split[2]] : title ? [title] : [];
  for (const part of parts) {
    const rest = split
      ? part.replace(new RegExp(split[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim()
      : part;
    const said = words(printed.join(' '));
    const significant = words(rest).filter((word) => !NOT_SIGNIFICANT.has(word));
    if (significant.length === 0 || significant.every((word) => said.includes(word))) continue;
    printed.push(part);
  }
  return printed;
}
/** The seat as 1 line: "State Representative, District 56A". */
export function candidateSeat(office?: string, area?: string): string {
  return seatParts(office, area).join(', ');
}
