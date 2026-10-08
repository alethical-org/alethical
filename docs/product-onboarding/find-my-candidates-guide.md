# How Find My Candidates works

<!-- describes: alethical/api/services/address_format.py, apps/frontend/src/lib/currentAddressInput.ts, apps/frontend/src/components/home/HomeCandidateFinder.tsx, apps/frontend/src/screens/CandidatesScreen.tsx, apps/frontend/src/screens/CandidateProfileScreen.tsx, apps/frontend/src/screens/CandidateAccountScreens.tsx, apps/frontend/src/screens/AdminCandidateClaimsScreen.tsx, apps/frontend/src/components/candidates/*.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/data/candidates.ts, apps/frontend/src/data/candidateClaims.ts, apps/frontend/src/hooks/useCandidatePrivacyBoundary.ts, apps/frontend/src/lib/candidatePrivacy.ts, apps/frontend/src/lib/candidatePageSnapshot.ts, apps/frontend/src/lib/candidatePublicCopy.ts, alethical/api/routers/candidates.py, alethical/api/routers/candidate_claims.py, alethical/api/services/candidate_lookup.py, alethical/api/services/candidate_legislators.py, alethical/api/data/candidate_legislator_links.json, alethical/api/services/candidate_claims.py, alethical/pipeline/candidate_ballot.py, alethical/db/models.py, alethical/alembic/versions/0066_candidate_lookup.py, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/lib/staticPageMetadata.ts, api/page.ts -->

## Public address lookup

Anyone can use `/candidates` without signing in. Its first response includes the
existing lookup instructions and privacy explanation, and its address appears in
the public pages sitemap. It does not publish a catalogue of saved candidate profiles. **Find my candidates** in Search
opens the empty form. The homepage form carries an address through temporary memory;
it never puts the address in a link or saved browser storage.

The full street address identifies the official street range, including house number,
odd/even side, street direction, city, ZIP and any source-defined unit boundaries.
Both address entry boxes grow to keep long addresses fully visible.
Typing, pasting and choosing a saved browser address use the same search. Keyboard
Search and **Find my candidates** submit the address visible in the box, including
a browser-filled value that arrived just before submission. The suggestion list
follows the current box value; an older highlighted choice cannot replace a newly
filled address. Entering or leaving the `/candidates` box also brings a newly
browser-filled value into its suggestion state.

After a complete street address, state and ZIP, **United States**, **United States
of America**, **US**, **USA**, **U.S.** and **U.S.A.** are accepted without changing
the address being matched. Spaces, commas, periods, semicolons, colons and dashes may separate or
follow that final country label; balanced parentheses may surround the label.
A final comma, period, semicolon or colon is also accepted
without a country label. Line breaks, tabs and repeated spaces from saved addresses
are treated as spaces. This cleanup preserves house numbers, units, directions,
city, state and ZIP+4; it does not discard another country, unknown trailing words
or other characters to force a match.

A city or ZIP alone cannot choose a ballot. Ambiguous addresses require an explicit
choice. An unsupported unit or overlapping range produces no match rather than a guess.
Address suggestions begin with a house number and enough of the street name to
match, using the same input rule as Find my legislator. A complete street, city or
ZIP is not required before suggestions can appear. After a short typing pause,
available matches appear below the field with **Suggested address** or **Suggested
addresses**. The first match has a green outline; arrow keys move that outline,
Enter chooses it, and Escape closes the list. A click or tap also chooses a match
and starts the candidate search. Later replies for older text cannot replace the
current suggestions or reopen a dismissed list. The list scrolls when needed.
Minnesota mapping services can supply a complete address when the ZIP is missing.
The voter must confirm that complete address, even when only 1 choice is returned.
Choosing a typing suggestion submits that complete address for official validation.
Choosing from a submitted ambiguous result retains the original typed address so
the service can recompute the same choice; approved abbreviations do not turn it
into an unmatched address.
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
Once a screen has drawn, a later program-download failure does not automatically
reload the website and erase this memory. A failed screen or section shows its
existing failure message and an explicit **Reload page** action; browser Back
can return to earlier results while the visit remains open. Choosing to reload
still clears candidate search memory. The shared recovery behavior is defined in
[page-load-performance-decisions.md, Recover failed downloads without losing a working visit](../operations/page-load-performance-decisions.md#recover-failed-downloads-without-losing-a-working-visit).

## Results and their limits

Results group state and federal offices, county offices, city or township offices,
school board, and other supported local offices. Judicial offices are state offices.
Each race carries its official source and the date Alethical read it, in Minnesota time.
The 5 groups use matching jump buttons and collapsible heading bars. The last
button says **Other local**. A **Judges** subsection at the end of State offices
starts closed. New addresses start with the main groups open; returning from a
profile restores the election, group state and scroll position. A jump button opens
its target before moving focus there. Printing reveals all groups.

Sources and check dates appear once per group when every race shares the exact
same facts; differing sources and dates stay beside the affected race. General
races show **1 seat to fill** or **{N} seats to fill** only when the source states
the count. Ticket races and primaries omit this label. A primary selection says
**Not every office has a primary**; official records decide which races appear.
A seat count appears only when the source states it. Questions and generic WRITE-IN
slots are excluded. A race with 1 candidate does not label that candidate a winner.

MyBallot supplies a joint governor/lieutenant-governor ticket as 1 label. Alethical
preserves that label and its shared profile rather than guessing separate identities.
Names sort by the supplied full name because this source does not supply a separate
surname. Payment and ownership never change ordering or prominence.

The **About these results** box follows the last available race group, with a 40px
gap, at every screen width. It stays visible for a successful search with no races.
Initial loading, an initial failure and no upcoming election do not show the box;
retained results during an update or failed replacement keep their own notices.
The box says that some local offices may be missing. This is a source-wide
coverage limit, not proof that a particular local race is absent. Minnesota says that
some local sample ballots are unavailable. [Minnesota sample ballot information](https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/)
remains available from every result. Alethical does not claim to list every possible
write-in candidate or to replace an official sample ballot.

The general warning and any named gaps stay together in that box with the
candidate-list disclaimer and sample-ballot link. The current response does not
identify a group for a gap, so the interface never guesses from office wording.
Source dates and stale warnings stay with the affected groups or races.
Empty race cards, including Judges, say **No candidates listed** and **The source
lists no candidates for this race**. An empty sample-ballot list does not establish
that nobody filed, and an absent office does not prove it is missing from the source.

A source outage, a missing address match, an empty candidate list and uncertain
coverage remain distinct. The last successful results stay visible during a replacement
and after a failed update, with their original address, election, source and dates.
Only the newest request can replace them. Errors retain the typed address and offer retry.
Changing an address keeps the form open while typing, even when the draft equals the
previous successful request. Only an explicitly submitted successful replacement or
Escape cancellation closes editing; a submitted recent cached result follows the same transition.
While an address search runs, both **Find my candidates** buttons show a spinner
and **Finding candidates…** inside their unchanged box. A screen reader receives
1 polite waiting announcement; the line below stays reserved for errors without
repeating the waiting message. Focus stays on the activated search button, repeated
clicks and Enter cannot submit again, and reduced motion stops the spinner. The
ready label returns after a result or error. Election changes keep their separate
**Updating candidates…** status.

The search button must receive the first click or tap while address suggestions are
visible. Keep the field focused during pointer activation so dismissing inline phone
suggestions cannot move the button between press and release; keyboard focus and
explicit outside dismissal retain their existing behavior.

## Public candidate profiles

`/candidates/<id>` is public and belongs to a specific candidate record, office and
election. The address works independently of a visitor's search. Unknown IDs return
not found; service failures return unavailable. IDs use source codes and the complete
jurisdiction, not a name-only match. Supported state, federal, judicial and school
district identities are shared across counties. County and municipal identities retain
their county scope when the source does not establish a wider identity.

The first response includes the same public facts, source/check dates, stale
warnings and confirmed legislator links as the loaded screen, without caching
private address requests or seeding visitor lookup results.

Profiles display only supported fields: source name, office, voting area, election,
party when supplied, campaign website when supplied, and source/check date. MyBallot
establishes ballot candidacy, not an original filing date; Alethical does not invent one.
After 24 hours, a saved record says it may be out of date. A fresh matching search updates
it. MyBallot has no address-free profile endpoint, so a direct profile visit alone does
not claim to refresh the official record.

Candidate results open the candidate profile. A confirmed same-person legislator
connection appears near the name with **View legislator profile** and **See their
bills, votes, and work in office**. The connection register records the official
identity evidence and validates the exact candidate record and held legislator
before displaying the link. A matching name alone is insufficient.

Confirmed current service is separate from the office sought. **Running for
reelection** requires the same current office and district; **Formerly served as**
requires a confirmed past service end date. Unknown service makes neither claim.
After election day has passed in Minnesota, the record says **Candidate for**.
Portraits use a confirmed person's existing official legislator image when
available, preserve its whole proportions, and disappear cleanly on failure. A
joint ticket retains its shared identity; a linked member's portrait and service
sit beside that member's name in the legislator panel.

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
The browser submits the statement version shown. If it changed, the reason stays
and **The campaign statement changed: reload it before reporting** appears with
**Reload statement**. The refreshed text is shown before another report can be
submitted. A removed statement cannot be reported. Rate-limit recovery uses the
server's actual wait and restores submission without a page reload.

## Later work

Candidate-specific paid services remain a later phase. This release does not add prices,
checkout or service offers inside claimed profiles. It does not introduce promise tracking
or promise-versus-vote scoring.

The [candidate lookup build and release plan](../implementation/candidate-lookup-build-plan.md)
records source evidence, tests and release history.
