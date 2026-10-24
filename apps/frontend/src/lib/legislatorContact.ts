// Contact links also appear before an address finder has loaded. Keep this small
// shared part separate from address-entry and district-error helpers.
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
