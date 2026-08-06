export type FindLegislatorState =
  | 'empty'
  | 'looking'
  | 'found'
  | 'choice'
  | 'not-found'
  | 'outside-minnesota'
  | 'location-error'
  | 'vacant'
  | 'service-down';

export function viewStateForLookup(input: {
  pending?: boolean;
  found?: boolean;
  choices?: number;
  vacant?: boolean;
  error?: 'not-found' | 'outside-minnesota' | 'location' | 'service-down';
}): FindLegislatorState {
  if (input.pending) return 'looking';
  if (input.choices) return 'choice';
  if (input.error === 'not-found') return 'not-found';
  if (input.error === 'outside-minnesota') return 'outside-minnesota';
  if (input.error === 'location') return 'location-error';
  if (input.error === 'service-down') return 'service-down';
  if (input.found && input.vacant) return 'vacant';
  if (input.found) return 'found';
  return 'empty';
}

export function addressChoiceKey(
  key: string,
  index: number,
  count: number,
): { index: number; action: 'move' | 'choose' | 'close' } | null {
  if (count < 1) return null;
  if (key === 'ArrowDown') return { index: (index + 1) % count, action: 'move' };
  if (key === 'ArrowUp') return { index: (index - 1 + count) % count, action: 'move' };
  if (key === 'Enter') return { index, action: 'choose' };
  if (key === 'Escape') return { index, action: 'close' };
  return null;
}

export function legislatureLabel(name: string): string {
  const match = name.match(/(\d+(?:st|nd|rd|th))\s+Legislature\s+\((\d{4})\s*[–-]\s*(\d{4})\)/i);
  return match
    ? `${match[1].toUpperCase()} LEGISLATURE (${match[2]}–${match[3]})`
    : name.toUpperCase();
}

export function contactEmail(value?: string | null): string | undefined {
  const cleaned = value?.trim().replace(/^mailto:/i, '');
  return cleaned && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : undefined;
}

export function senateProfileUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/[?&]leg_id=(\d+)/i);
  return match
    ? `https://www.senate.mn/members/member_bio.html?leg_id=${match[1]}`
    : value.replace(/^http:/i, 'https:');
}

export function districtMapVisible(isMobile: boolean, expanded: boolean) {
  return !isMobile || expanded;
}
