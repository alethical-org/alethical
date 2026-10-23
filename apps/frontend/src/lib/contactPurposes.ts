/**
 * Contact actions whose purpose is known open the form with editable starting
 * words. Only these keys are trusted; any other `purpose` in an address is ignored.
 */
export const CONTACT_PURPOSES = ['host-debate', 'correction', 'feature-request'] as const;

export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];

export function contactPurpose(value: string | null | undefined): ContactPurpose | undefined {
  return CONTACT_PURPOSES.find((purpose) => purpose === value);
}
