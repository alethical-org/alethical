import { useQuery } from '@tanstack/react-query';

import { getDisclosureStatement, getUnlinkedStatements } from '../data/disclosureStatements';
import {
  disclosureStatementQueryKey,
  unlinkedStatementsQueryKey,
} from '../lib/committeeMoneyQueryKeys';
import { unlinkedStatementsFromPayload } from '../lib/disclosureStatementCopy';
import { seededQuery } from '../lib/pageData';

/** One statement's reading, loaded only once its payment row is open (#2347). */
export function useDisclosureStatement(statementId: string, enabled: boolean) {
  return useQuery({
    queryKey: disclosureStatementQueryKey(statementId),
    queryFn: ({ signal }) => getDisclosureStatement(statementId, signal),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** The committee-year's statements that match no payment, read on their own so no
 *  payment-list failure, search or tab can hide one. */
export function useUnlinkedStatements(
  registrationNumber: string | null,
  year: number,
  enabled = true,
) {
  const key = unlinkedStatementsQueryKey(registrationNumber, year);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getUnlinkedStatements(registrationNumber ?? '', year, signal),
    ...seededQuery(key, (payload: unknown) => {
      const listed = unlinkedStatementsFromPayload(payload);
      if (!listed) throw new Error('unreadable seeded statements');
      return listed;
    }),
    enabled: Boolean(registrationNumber) && enabled,
    retry: false,
  });
}
