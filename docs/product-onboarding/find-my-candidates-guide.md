# How Find My Candidates works

<!-- describes: apps/frontend/src/screens/CandidatesScreen.tsx, apps/frontend/src/screens/CandidateProfileScreen.tsx, apps/frontend/src/screens/CandidateAccountScreens.tsx, apps/frontend/src/screens/AdminCandidateClaimsScreen.tsx, apps/frontend/src/components/candidates/*.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/data/candidates.ts, apps/frontend/src/data/candidateClaims.ts, apps/frontend/src/hooks/useCandidatePrivacyBoundary.ts, apps/frontend/src/lib/candidatePrivacy.ts, alethical/api/routers/candidates.py, alethical/api/routers/candidate_claims.py, alethical/api/services/candidate_lookup.py, alethical/api/services/candidate_claims.py, alethical/pipeline/candidate_ballot.py, alethical/db/models.py, alethical/alembic/versions/0066_candidate_lookup.py, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/lib/staticPageMetadata.ts, api/page.ts -->

## Public address lookup

Anyone can use `/candidates` without signing in. **Find my candidates** in Search
opens the empty form. The homepage form carries an address through temporary memory;
it never puts the address in a link or saved browser storage.

The full street address identifies the official street range, including house number,
odd/even side, street direction, city, ZIP and any source-defined unit boundaries.
Both address entry boxes grow to keep long addresses fully visible.
A city or ZIP alone cannot choose a ballot. Ambiguous addresses require an explicit
choice. An unsupported unit or overlapping range produces no match rather than a guess.
Minnesota mapping services can supply a complete address when the ZIP is missing.
The voter must confirm that complete address, even when only 1 choice is returned.
The confirmation retains the original typed address so the service can recompute
the same choice; approved abbreviations do not turn it into an unmatched address.
Supplied unit numbers remain attached to the choice and must match official ranges.

The connected source is [Minnesota MyBallot](https://myballotmn.sos.mn.gov/).
The supported election is November 3, 2026, general election, source ID `8334`.
The choice expires after election day in Minnesota; an older election never silently
replaces it. Adding the next election requires a source check and an explicit update.

Each search reads fresh ballot records. Street tables may be reused for 5 minutes,
bounded to 32 ZIP tables and 8 MB of source text. The browser may reuse an identical
successful search for 60 seconds, with at most 4 searches held in memory. Clearing
the search or changing signed-in accounts erases these responses. Returning from a profile restores the search;
reloading or opening a new tab loses it.

## Results and their limits

Results group state and federal offices, county offices, city or township offices,
school board, and other supported local offices. Judicial offices are state offices.
Each race carries its official source and the date Alethical read it, in Minnesota time.
A seat count appears only when the source states it. Questions and generic WRITE-IN
slots are excluded. A race with 1 candidate does not label that candidate a winner.

MyBallot supplies a joint governor/lieutenant-governor ticket as 1 label. Alethical
preserves that label and its shared profile rather than guessing separate identities.
Names sort by the supplied full name because this source does not supply a separate
surname. Payment and ownership never change ordering or prominence.

The coverage panel says that some local offices may be missing. This is a source-wide
coverage limit, not proof that a particular local race is absent. Minnesota says that
some local sample ballots are unavailable. [Minnesota sample ballot information](https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/)
remains available from every result. Alethical does not claim to list every possible
write-in candidate or to replace an official sample ballot.

A source outage, a missing address match, an empty candidate list and uncertain
coverage remain distinct. The last successful results stay visible during a replacement
and after a failed update, with their original address, election, source and dates.
Only the newest request can replace them. Errors retain the typed address and offer retry.

## Public candidate profiles

`/candidates/<id>` is public and belongs to a specific candidate record, office and
election. The address works independently of a visitor's search. Unknown IDs return
not found; service failures return unavailable. IDs use source codes and the complete
jurisdiction, not a name-only match. Supported state, federal, judicial and school
district identities are shared across counties. County and municipal identities retain
their county scope when the source does not establish a wider identity.

Profiles display only supported fields: source name, office, voting area, election,
party when supplied, campaign website when supplied, and source/check date. MyBallot
establishes ballot candidacy, not an original filing date; Alethical does not invent one.
After 24 hours, a saved record says it may be out of date. A fresh matching search updates
it. MyBallot has no address-free profile endpoint, so a direct profile visit alone does
not claim to refresh the official record.

The stored evidence contains candidate records and their source hash, not visitor
addresses, coordinates, precinct names, range IDs or account associations. Private
address requests bypass browser and shared caches. Source exceptions do not expose
submitted addresses. Illustrative records remain restricted to an explicitly enabled
development preview and cannot appear in production.

## Claiming and managing a profile

`/candidates/<id>/claim` uses the existing Alethical account. Browsing remains public.
An applicant supplies a public campaign or official-record link and a private explanation
of their role and how ownership can be established. Alethical does not fetch applicant
links automatically. A public filing, uploaded record, email domain or ordinary sign-in
alone never grants control. No verification email is sent by this workflow.

A confirmed, active account can request review and see its own status. A staff member
uses `/admin/candidate-claims`, independently verifies control through a trusted contact,
and records the private evidence before approval. The queue identifies the requesting
account by its confirmed email address. Staff cannot approve their own claims.
Approval requires a current-election source record checked within 24 hours. At most 1
account can own a profile. Competing requests require review; ownership never transfers
automatically. Staff can reject requests and revoke access. Applicants can withdraw.

An approved owner uses `/candidates/<id>/manage` for a plain-text statement of at most
2000 characters. Preview, publication, edits and removal keep the official record intact.
The public campaign block identifies its authorship and explains what verified access
means. Campaign statements are excluded from official-record answers and search material
used by Grounded Ask. Private revision history remains available to the owner and staff.

Updates include an account ID and a saved version. An account change or an older editor
cannot overwrite a newer result. A same-account sign-in refresh preserves unsaved
text; changing accounts clears it. Revocation, withdrawal, deactivation and account deletion
remove the public statement from subsequent reads. Account deletion also removes the
account's private claims and statement history through database relationships.

Readers can report a published statement. Staff receive the reason and the exact text
and version reported, even if the campaign edits it before review. Reports and verification
notes are private. Database failures return a generic unavailable response without
passing private notes into server error logs. Public report submission is rate limited and sends no email.

## Later work

Candidate-specific paid services remain a later phase. This release does not add prices,
checkout or service offers inside claimed profiles. It does not introduce promise tracking
or promise-versus-vote scoring.

The [candidate lookup build and release plan](../implementation/candidate-lookup-build-plan.md)
records source evidence, tests and release history.
