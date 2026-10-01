import type { CandidateProfileRecord } from '../components/candidates/types';
import { pageMetadata, type PageMetadata } from './share';

/** Metadata belongs to this public election record, never the visitor's search. */
export function candidateProfileMetadata(record: CandidateProfileRecord): PageMetadata {
  const name = record.candidate.name;
  return pageMetadata({
    title: `${name} | Alethical`,
    socialTitle: name,
    description: `${name}. ${record.office}, ${record.votingArea}. ${record.election.label}, ${record.election.date}. Candidate records from ${record.source.authority}.`,
    canonicalPath: `/candidates/${record.candidate.id}`,
  });
}
