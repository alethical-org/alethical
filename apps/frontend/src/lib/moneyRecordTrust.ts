/** Shared limits describe the records, never a confidence score or a claim of completeness. */
export const CONTRIBUTION_RECORD_LIMIT =
  'The count is of matching records, not a confirmed count of separate donations. These records may not capture all giving.';
export const NAME_REGISTRATION_DIFFERENCE =
  'Name-based and registration-based counts can differ because names vary and some records lack registration numbers.';
export const REGISTRATION_MATCH_LIMIT =
  'Matching uses the lobbyist’s registration number in the contribution file or an official report. A missing number is confirmed only when the report’s registration number, donor name, payment date and amount establish a unique match. A name alone is not enough. Contributions reported without donor names cannot be matched. No matching records does not mean no giving.';
export const SMALL_CONTRIBUTION_LIMIT =
  'Contributions totaling $200 or less from a donor to the same committee, party unit or fund in a calendar year may be reported without naming the donor. The threshold is $500 for ballot-question committees and funds. Smaller individual payments can still be named, including when the donor’s yearly total exceeds the threshold.';
export const CONTRIBUTION_REPORTING_URL =
  'https://www.revisor.mn.gov/statutes/cite/10A.20#stat.10A.20.3';
export const CONTRIBUTION_REPORTING_LABEL = 'View Minnesota’s contribution reporting requirements';
export const CONTRIBUTION_PERIOD_LIMIT =
  'Each record comes from the receiving committee’s filing. Committees report on different schedules, so the available records may not cover a full year.';
export const REPEATED_RECORD_LIMIT =
  'Repeated or corrected filings can affect record counts. Identical names, dates and amounts alone do not establish that entries are the same donation.';
export const FILE_COPY_MEANING =
  'The copy date is when Alethical obtained the source, not the end date of every filing.';
export const MONEY_SOURCE_COVERAGE =
  'Financial totals and individual payment records can have different coverage. Each section identifies its source and reporting period.';
export const OFFICIAL_TOTAL_RECORD_LIMIT =
  'Official report totals can include contributions without donor names. Individual records shown here may not add up to those totals.';
export const MATCHED_NAME_LIMIT =
  'Records are grouped by the name recorded in the source. Different spellings appear separately, and a matching name alone does not establish identity.';

/** A dated, evidenced comparison, not a rule deduced from matching names or amounts.
 * Keep source rows intact. Refreshing a source requires reviewing open findings.
 * Evidence and scope: docs/research/carlson-contribution-record-review.md.
 */
export function contributionRecordReview(registrationNumber: string, releaseId: string | null) {
  if (registrationNumber !== '8692' || releaseId !== 'af236cca-a4f8-4efe-9a3a-025259ea380e')
    return null;
  return {
    title: 'All-years count under review',
    body: 'The September 1, 2026 source contains 1,194 records carrying registration 8692 across all years. A download obtained September 19, 2026 contains 1,203. The difference includes corrected registration numbers and added records, including a suspected repeated donation. Report-confirmed matches may add records to this profile without changing the source file. The number of separate donations remains unresolved.',
  };
}
