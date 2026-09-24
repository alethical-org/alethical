import { publicApiRequest } from './api';
import {
  statementDetailFromPayload,
  unlinkedStatementsFromPayload,
  type StatementDetail,
  type UnlinkedStatements,
} from '../lib/disclosureStatementCopy';

/** One statement's reading. */
export async function getDisclosureStatement(
  statementId: string,
  signal?: AbortSignal,
): Promise<StatementDetail> {
  const { data } = await publicApiRequest<{ data: unknown }>(
    `/campaign-finance/disclosure-statements/${encodeURIComponent(statementId)}`,
    signal,
  );
  const detail = statementDetailFromPayload(data);
  if (!detail) throw new Error('unreadable statement answer');
  return detail;
}

/** One committee's statements for one year that match no payment row. A payload the card
 *  cannot read is a failure, never an empty list. */
export async function getUnlinkedStatements(
  registrationNumber: string,
  year: number,
  signal?: AbortSignal,
): Promise<UnlinkedStatements> {
  const { data } = await publicApiRequest<{ data: unknown }>(
    `/committees/${encodeURIComponent(registrationNumber)}/disclosure-statements?year=${year}`,
    signal,
  );
  const listed = unlinkedStatementsFromPayload(data);
  if (!listed || listed.registrationNumber !== registrationNumber || listed.year !== year) {
    throw new Error('unreadable unlinked statements answer');
  }
  return listed;
}
