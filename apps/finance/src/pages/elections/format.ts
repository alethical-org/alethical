/** Exact source decimals, without converting dollars through floating point. */
export function exactMoney(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return 'Not available';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const cents = fraction.padEnd(2, '0').replace(/0+$/, '').padEnd(2, '0');
  const integer = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative && /[1-9]/.test(value) ? '−' : ''}$${integer}.${cents}`;
}

export function dateLabel(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Date not available';
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : 'Date not available';
}

export const count = (value: number | null | undefined) =>
  value == null ? 'Not available' : value.toLocaleString('en-US');
export const pageNumber = (value: string) =>
  /^\d+$/.test(value) ? Math.max(1, Math.min(1_000_000, Number(value))) : 1;
export const periodLabel = (start: string | null | undefined, end: string | null | undefined) =>
  start && end ? `${dateLabel(start)} to ${dateLabel(end)}` : 'Report dates not available';

/** Contiguous physical lines are ranges; separate source lines remain separate. */
export function lineLabel(values: number[]): string {
  const lines = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    let last = first;
    while (lines[i + 1] === last + 1) last = lines[++i];
    ranges.push(first === last ? String(first) : `${first}–${last}`);
  }
  return `${lines.length === 1 ? 'Line' : 'Lines'} ${ranges.join(', ')}`;
}
