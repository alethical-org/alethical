import { useRead, type Read } from '../api/read';

/**
 * A few shared Alethical API routes (`/candidates/{id}`, `/people/{id}`,
 * `/people/for-legislator/{slug}`) answer with the record itself rather than
 * `{ data: … }`. A record page never shows another record while its own loads.
 */
export function useRecordRead<T>(path: string | null): Read<T> {
  return useRead<T>(path, { unwrapped: true });
}
