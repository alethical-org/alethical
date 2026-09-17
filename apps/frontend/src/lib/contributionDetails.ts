/** Shared links retain each committee/year's independently opened contribution rows. */
export function contributionDetailRows(
  value: string | undefined,
  registrationNumber: string,
  year: number,
): number[] {
  return [0, 1, 2].filter((row) =>
    (value ?? '').split(',').includes(`${registrationNumber}.${year}.${row}`),
  );
}

export function withContributionDetailRows(
  value: string | undefined,
  registrationNumber: string,
  year: number,
  rows: readonly number[],
): string | undefined {
  const prefix = `${registrationNumber}.${year}.`;
  const other = (value ?? '')
    .split(',')
    .filter((entry) => /^\d+\.\d{4}\.[012]$/.test(entry) && !entry.startsWith(prefix));
  return (
    [
      ...other,
      ...[0, 1, 2].filter((row) => rows.includes(row)).map((row) => `${prefix}${row}`),
    ].join(',') || undefined
  );
}
