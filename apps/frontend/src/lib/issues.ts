// Issue (policy-area) values are stored and filtered in lowercase (e.g.
// "public safety"); this formats one for display in Title Case ("Public
// Safety"). Display only — never transform a value used in the /bills
// policy_area filter, which matches whole elements exactly.
export const titleCaseIssue = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
