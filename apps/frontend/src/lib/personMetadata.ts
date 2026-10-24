import type { PersonRecord } from '../data/personRecords';
import { pageMetadata } from './share';

/** A person's public record has one address, independent of the return journey. */
export function personPageMetadata(record: PersonRecord) {
  return pageMetadata({
    title: `${record.name} | Alethical`,
    socialTitle: record.name,
    description: `${record.name}. Elections, service and research from public records, with sources.`,
    canonicalPath: `/people/${record.id}`,
  });
}
