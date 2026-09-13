import type { CommitteeConfirmation } from '../data/types';

/** The whole current relationship, never a field on the dated financial answer. */
export interface ApiCommitteeConfirmationPayload {
  registration_number: string;
  current_claim_validated_at?: string | null;
  confirmed_for?: {
    legislator_id?: string | null;
    slug?: string | null;
    full_name?: string | null;
    checked?: {
      checked_on: string;
      name_evidence?: string | null;
      register_verdict?: string | null;
      party_agreement?: string | null;
    } | null;
  } | null;
}

export const committeeConfirmationQueryKey = (registrationNumber: string | null) =>
  ['committee-confirmation', registrationNumber] as const;

export const CONFIRMATION_LOADING_LINE = 'Checking whose committee this is…';
export const CONFIRMATION_UNAVAILABLE_LINE =
  'We could not check whose committee this is. The money shown here is the committee’s own filed record.';

/** Explicit null is a valid answer. Missing or incomplete identity is a failed read. */
export function committeeConfirmationFromPayload(
  payload: ApiCommitteeConfirmationPayload,
  options: { servedAgeMs: number },
): CommitteeConfirmation {
  const member = payload?.confirmed_for;
  if (
    typeof payload?.registration_number !== 'string' ||
    !payload.registration_number ||
    member === undefined ||
    (member !== null &&
      (typeof member.legislator_id !== 'string' ||
        !member.legislator_id ||
        typeof member.slug !== 'string' ||
        !member.slug ||
        typeof member.full_name !== 'string' ||
        !member.full_name))
  ) {
    throw new Error('Committee confirmation is incomplete');
  }
  return {
    registrationNumber: payload.registration_number,
    confirmedFor:
      member === null
        ? null
        : {
            legislatorId: member.legislator_id!,
            slug: member.slug!,
            fullName: member.full_name!,
            checked: member.checked
              ? {
                  checkedOn: member.checked.checked_on,
                  nameEvidence: member.checked.name_evidence ?? null,
                  registerVerdict: member.checked.register_verdict ?? null,
                  partyAgreement: member.checked.party_agreement ?? null,
                }
              : null,
          },
    currentClaim: {
      servedAgeMs: options.servedAgeMs,
      validatedAt: payload.current_claim_validated_at ?? null,
    },
  };
}
