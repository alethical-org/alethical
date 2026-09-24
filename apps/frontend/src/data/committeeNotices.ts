import { publicApiRequest } from './api';
import { committeeNoticesFromPayload, type CommitteeNotices } from '../lib/committeeNotices';

/** One committee's notices for one year. A payload the page cannot read is a failure,
 *  never an empty card. */
export async function getCommitteeNotices(
  registrationNumber: string,
  year: number,
  signal?: AbortSignal,
): Promise<CommitteeNotices> {
  const { data } = await publicApiRequest<{ data: unknown }>(
    `/committees/${encodeURIComponent(registrationNumber)}/notices?year=${year}`,
    signal,
  );
  const notices = committeeNoticesFromPayload(data);
  if (!notices) throw new Error('unreadable notices answer');
  return notices;
}
