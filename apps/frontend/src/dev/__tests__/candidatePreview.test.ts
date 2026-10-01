import { expect, it } from 'vitest';
import {
  candidatePreviewProfile,
  candidatePreviewServices,
  candidatePreviewSettings,
} from '../candidatePreview';

it('gives every illustrative search result a matching profile for the same election, including joint tickets', async () => {
  candidatePreviewSettings.scenario = 'full';
  candidatePreviewSettings.slow = false;
  const controller = new AbortController();
  const elections = await candidatePreviewServices.getElections(controller.signal);
  for (const election of elections) {
    const result = await candidatePreviewServices.lookup(
      { address: '100 Example Street', electionId: election.id },
      controller.signal,
    );
    expect(result.kind).toBe('results');
    if (result.kind !== 'results') throw new Error('Missing fixture results');
    for (const race of result.races)
      for (const entry of race.entries) {
        const id = entry.kind === 'candidate' ? entry.candidate.id : entry.id;
        const profile = candidatePreviewProfile(id);
        expect(profile, id).toBeDefined();
        expect(profile?.election.id, id).toBe(election.id);
        expect(profile?.office, id).toBe(race.office);
        expect(profile?.source).toEqual(race.source);
        if (entry.kind === 'ticket') {
          expect(profile?.isJointTicket).toBe(true);
          expect(profile?.candidate.name).toBe(entry.members[0].name);
        }
      }
  }
});
