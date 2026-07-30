// How a legislative session is named on screen.
//
// Kept out of the search components so it is importable on its own — the test
// runner can't load a module that pulls in React Native components.

// The session filter reads as "2025–2026 Legislative Session" — the year range
// a regular person recognizes, not the DB's formal chamber name. formatSession-
// Label reshapes the served name (e.g. "94th Legislature (2025 - 2026) Regular
// Session") into that; the fallback covers the pre-load render.
export function formatSessionLabel(name: string): string {
  const years = name.match(/\b(20\d{2})\b(?:\s*[-–]\s*(20\d{2}))?/);
  if (!years) return name;
  const range = years[2] ? `${years[1]}–${years[2]}` : years[1];
  // A special session keeps those words: it is a separate session with its own
  // bills, and without them it would read "2025 Legislative Session" beside the
  // biennium's "2025–2026 Legislative Session" with nothing to tell them apart
  // (#746). Matches the wording the Revisor's own cross-references use.
  const special = name.match(/\b(\w+)\s+special session\b/i);
  if (special) return `${range} ${special[1]} Special Session`;
  return `${range} Legislative Session`;
}

export const SESSION_LABEL_FALLBACK = '2025–2026 Legislative Session';
