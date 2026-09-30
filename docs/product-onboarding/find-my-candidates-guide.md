# How Find My Candidates works

<!-- describes: apps/frontend/src/screens/CandidatesScreen.tsx, apps/frontend/src/screens/CandidatePreviewScreens.tsx, apps/frontend/src/components/candidates/*.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/lib/candidateLookupAvailability.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/lib/staticPageMetadata.ts, api/page.ts -->

## The public `/candidates` page

`/candidates` is public. Anyone can open it without an account. The **Find my
candidates** link in the Search menu is its approved entry point. Open `/candidates`
directly or follow a shared link to the same address.

The `/candidates` page says **Find My Candidates** and **Candidates for Minnesota
state and local offices**. It shows a Minnesota outline and this notice:

> Candidate records are not available on Alethical yet

This describes Alethical's source connection, not whether Minnesota has published
candidate records. Alethical has not connected the live address lookup, election
list, or public candidate record pages. The **Minnesota sample ballot information**
link opens the [Secretary of State's ballot guidance](https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/).

The public `/candidates` page has no address box, election selector, candidate results,
or claim controls. It collects no street address and makes no candidate lookup or
address-suggestion request. It does not claim to send an address to the Census Bureau.
Its public address returns a normal successful response, with its own title and a
description that includes the current limitation. Illustrative candidate profile
addresses return not found on the public server.

The unavailable notice is the current public state. It is not an empty result saying
nobody is running. The public `/candidates` page has no candidate-service loading,
retry, or failed-search state while that service remains unconnected. Opening the
official ballot link is the available way to reach Minnesota's own information.

## Illustrative development review

Developers can opt into the search/results/profile review with
`EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW=true` in a development build. A production build
never activates this review, even when that setting is present.

The review says **ILLUSTRATIVE DATA** and explains that its example names are not
candidate records. It has no **PRIVATE DRAFT** label. Addresses entered there stay
in temporary browser memory and the illustrative service makes no government lookup.
They do not enter profile addresses, saved browser storage, or account records.
Reloading clears the search. Returning from a profile within the same app restores
the current search.

The review supports a full Minnesota street address, address suggestions, explicit
choices for an ambiguous address, an election selector, and read-only profiles. Results
group offices and alphabetize candidate names. Missing district coverage is stated
before the races. An empty response says **No candidate records to show for this
address and election**; it does not claim nobody filed.

While a replacement loads, the previous address, election, and results stay together.
A failed replacement keeps the previous results and offers **Try again**. A newer
search supersedes a slow older response. Example controls let reviewers exercise
partial coverage, no match, an address outside Minnesota, too many searches, failed
searches, ambiguous addresses, empty results, and slow responses. These are review
examples, not public candidate evidence.

## What remains separate

Real candidate results need retained official source records, election-specific
matching, coverage and freshness checks, and a tested live connection. Candidate
profile claiming also needs an approved ownership-verification process. Opening the
public `/candidates` page does not release claims, candidate statements, uploaded
evidence, verification emails, or paid candidate services.

The [candidate lookup build and release plan](../implementation/candidate-lookup-build-plan.md)
holds the approved work order, source evidence and release history.
