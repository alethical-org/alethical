# How Find My Candidates works

<!-- describes: alethical/api/services/address_format.py, apps/frontend/src/lib/currentAddressInput.ts, apps/frontend/src/lib/addressSuggestion.ts, apps/frontend/src/components/address/*.tsx, apps/frontend/src/components/home/HomeCandidateFinder.tsx, apps/frontend/src/screens/CandidatesScreen.tsx, apps/frontend/src/screens/CandidateProfileScreen.tsx, apps/frontend/src/screens/CandidateAccountScreens.tsx, apps/frontend/src/screens/AdminCandidateClaimsScreen.tsx, apps/frontend/src/components/candidates/*.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/lib/candidateAddressUnit.ts, apps/frontend/src/data/candidates.ts, apps/frontend/src/data/candidateClaims.ts, apps/frontend/src/hooks/useCandidatePrivacyBoundary.ts, apps/frontend/src/lib/candidatePrivacy.ts, apps/frontend/src/lib/candidatePageSnapshot.ts, apps/frontend/src/lib/candidatePublicCopy.ts, alethical/api/routers/candidates.py, alethical/api/routers/candidate_claims.py, alethical/api/services/candidate_lookup.py, alethical/api/services/candidate_legislators.py, alethical/api/data/candidate_legislator_links.json, alethical/api/services/candidate_claims.py, alethical/api/services/admin_access.py, alethical/api/services/candidate_claim_identity.py, alethical/api/services/candidate_claim_events.py, alethical/api/services/candidate_claim_email.py, alethical/api/services/candidate_claim_recheck.py, alethical/api/services/candidate_recheck.py, alethical/api/services/person_records.py, alethical/api/routers/people.py, alethical/api/data/candidate_person_records.json, alethical/pipeline/candidate_person_records.py, alethical/pipeline/data/candidate_recheck_references_2026_v1.json, alethical/alembic/versions/0068_profile_claim_review.py, alethical/alembic/versions/0069_candidate_person_records.py, apps/frontend/src/screens/PersonOverviewScreen.tsx, apps/frontend/src/components/candidates/PersonOverviewContent.tsx, apps/frontend/src/components/candidates/PersonResearch.tsx, apps/frontend/src/data/personRecords.ts, apps/frontend/src/lib/personRecords.ts, alethical/pipeline/candidate_ballot.py, alethical/db/models.py, alethical/alembic/versions/0066_candidate_lookup.py, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/lib/staticPageMetadata.ts, api/page.ts, apps/frontend/src/screens/CandidateFeaturesScreen.tsx, apps/frontend/src/lib/candidateFeatures.ts, apps/frontend/src/lib/profileClaimDraft.ts, apps/frontend/src/components/GoBackLink.tsx -->

## Public address lookup

Anyone can use `/candidates` without signing in. Its first response includes the
existing lookup instructions and privacy explanation, and its address appears in
the public pages sitemap. It does not publish a catalogue of saved candidate profiles. **Find my candidates** in Search
opens the empty form. The homepage form carries an address through temporary memory;
it never puts the address in a link or saved browser storage.

The full street address identifies the official street range, including house number,
odd/even side, street direction, city, ZIP and any source-defined unit boundaries.
Both address entry boxes grow to keep long addresses fully visible. A filled box shows a 44px
**Clear address** button (×), including a browser-filled value. Clearing empties
and focuses the box without searching, dismisses choices, and ignores late replies.
It removes address-specific errors but retains service failures and existing results.
On entry the box keeps 18px of right padding while empty and 60px once it holds
text, so the placeholder fits and typed text never runs under the ×. The
**Change address** box keeps its reserved space whether empty or busy.
Typing, pasting and choosing a saved browser address use the same search. Keyboard
Search and **Find** submit the address visible in the box, including
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

For a postal city beginning with Saint, **SAINT**, **ST** and **ST.** are equivalent.
The remaining city words still must match the election source exactly. This keeps
Minnesota's **SAINT PAUL** map addresses usable with the election source's **ST PAUL**
records without relaxing house number, street, ZIP, unit or election-range checks.

A failed official match says **We couldn’t match that address to election records**,
on `/candidates` and the homepage candidate search. A mapped street address can
still lack a matching election street range; this message does not assert that
the reader mistyped it. Missing-input and outside-Minnesota messages remain distinct.

A city or ZIP alone cannot choose a ballot. Ambiguous addresses require an explicit
choice. An unsupported unit or overlapping range produces no match rather than a guess.
Address suggestions begin with a house number plus at least 2 street-name characters
(`29308 Cr`), or the first numbered-street digit (`350 5`). A house number alone
does not trigger suggestions. A lone street-name word that is also a street type,
such as `1006 Summit`, still offers matching streets while typing; submitted-address
checks stay unchanged. The first eligible input starts a request immediately;
continued typing waits for a 180-millisecond pause to group edits into 1 request.
An edit after at least 180 milliseconds of idle time also starts immediately. Pasting,
dropping or accepting a browser-provided replacement skips the typing pause. Spaces
before or after the same address reuse its pending request or recent successful
reply; spaces within the address remain distinct. Up to
5 Minnesota matches appear with **Suggested address** or **Suggested addresses**.
The field can reuse an exact successful input for 60 seconds, keeping at most 8
entries only in that mounted field’s memory. Clearing the field, starting a search,
changing its suggestion source or leaving the form clears these entries. No
address suggestions are saved in browser storage or a shared server cache. Slow, failed
or empty optional suggestions leave the list closed; submitting the typed address
still works and has its own waiting, error and retry feedback.

No suggestion is selected when the list opens. Down starts at the first row and
Up at the last; both wrap. Enter chooses a keyboard-selected row, otherwise it
submits the typed text. Escape, Tab and clicking outside dismiss the list without
changing the text. Keyboard focus stays in the address box. Mouse hover is grey;
the keyboard-selected row is pale green. Hover does not change Enter's choice.
System high-contrast mode adds a visible system-color outline to the active row.
A screen reader hears the count on every opening and count change while open.

A completed click or tap selects the printed address and starts the candidate
search. Starting a touch, scrolling or cancelling a gesture does not select it.
Focus leaving the field cannot swallow the first tap or move the Search button
between press and release. Editing or browser autofill clears the old keyboard
choice. Late replies cannot replace newer suggestions or reopen a dismissed list.

The field is labelled **Full street address**, 8px above the box. On entry, **A city
or ZIP code alone cannot identify your local races** is the first of the 2 grey
lines below the divider, and the box still names it as its description, so a screen
reader hears it in the box. **Change address** on the results page prints no help
line: the label sits 10px above the field, and the field's screen-reader description
names only the message slot. The help line prints once per page. Full addresses wrap.
On computer and tablet the list overlays content 8px below the box, exactly the
box's width. In **Change address**, the form's containing layer keeps every
suggestion above the following Election label and selector, including the rows
that extend beyond the form. The list remains below the site navigation and dialogs. On phones it sits in the page flow and pushes the button below it.
All rows remain reachable through page scrolling, without a nested list scroller.
When necessary, opening the list or the keyboard's later resize reveals the field
and available rows while keeping the label visible. Manual scrolling stops further
unsolicited movement until the list closes; deliberate arrow keys still reveal
the selected row. The source line stays below the form: **Address lookup uses
Minnesota’s Secretary of State and mapping services**. On computer and tablet,
the divider sits 56px below the message area and an open suggestion list overlays
both grey lines and the outline: opaque, above them, and taking every click. Phone
spacing remains 36px, and phone suggestions push content down. Neither position
changes with suggestion count. The introductory line is **See who’s running where
you live in Minnesota**.

Entry is 1 column on every band, at most 840px wide and centred. The address box,
**Find** and **Use my location** share 1 row on computer and tablet; on phones they
stack, each full width. The decorative Minnesota outline sits below the source line,
centred, 40px below it: 200 × 220 on computer and tablet, 160 × 176 on phones.

The submit button says **Find** on entry and in **Change address**, matching
`/find-my-legislator`; the page heading supplies the search context. The homepage
link keeps **Find my candidates**. Candidate profiles use the standard **Go back**
link, returning to the previous Alethical page in the tab or `/candidates` on a
direct visit.
Entry fields and buttons have a 60px minimum height. Entry **Find** is 150px wide on
computer and tablet and full width on phones. The magnifier and word form 1 group
with a 9px gap, centred 3px left of true centre because the thin icon carries less
weight than the bold word. **Change address** retains its compact 56px field and
52px minimum button height; its **Find** takes the rest of the row beside **Cancel**
and keeps the same 1 group and nudge. A hidden copy of the waiting group only
reserves the box's width, so it never separates the visible icon from its word. Wrapped or enlarged waiting
text can grow the action row; the ready state reserves the same height and Cancel
stays aligned. Both use the same suggestion component.
Minnesota mapping services can supply a complete address when the ZIP is missing.
The voter must confirm that complete address, even when only 1 choice is returned.
Before offering a typing suggestion or submitted address choice, the candidate
service checks that its complete address resolves to exactly 1 official election
street range. This includes house number, parity, direction, city, ZIP, suffix and
unit. Map addresses absent from the election source, or belonging to overlapping
ranges, are omitted. This does not establish that an omitted address is invalid.
The legislator finder keeps its separate map-based coverage; it does not require
an election street range. Choosing a typing suggestion revalidates the printed
complete address and then loads its ballot; an earlier suggestion never bypasses
source validation or guarantees the source remains available.

Validation loads each distinct ZIP table once per suggestion request, with at most
5 ZIP requests running together and the existing 5-minute public street-table cache.
Simultaneous requests for the same ZIP share 1 download of its public table, and a
failed download reaches each of them without being kept. When the legislator finder's
copy of Minnesota's published address file is on, candidate suggestions can start
from that copy and still pass this election street-range check before they appear.
Choosing a suggestion that carries the reader's own apartment or ZIP+4 detail searches
that full shown text through the same checks as a typed address.
It does not fetch candidate ballots while typing or cache visitor addresses on the
server. If an official table cannot be read, suggestions are unavailable rather than
reported as a successful empty response.
Choosing from a submitted ambiguous result retains the original typed address so
the service can recompute the same choice; approved abbreviations do not turn it
into an unmatched address. This **Choose your address** confirmation remains a
separate step with its existing keyboard guidance.

The official match reads a unit at the end of the street segment, after a comma
(`350 S 5th St, Apt 3, Minneapolis`) or after the city (`350 S 5th St Minneapolis Apt
3 MN 55415`), with or without a dot after the label (`Apt. 3`). 2 different units in 1
address are refused, never reconciled: a unit is 1 optional label (`Apt`, `Apartment`,
`Unit`, `Suite`, `Ste` or `#`) and 1 value, so `Apt 3 #4`, `Apt 3 Apt 4` or a unit
followed by other words is refused at every kind of range. `Apt.250`, `Apt. 250` and
`Apt 250` are the same unit. Street types compare in either spelling
(`Ter` and `Terrace`).

A unit at a house whose range the source does not mark for units reads that house's
range, as Minnesota's own sample-ballot site does: it asks for no unit there, because
every unit at the house shares the range. If any range at the house is marked, an
unmarked one never stands in for a unit.

Some buildings are split between ballot ranges by apartment number. Minnesota's
street table marks those house ranges as needing a unit (`DisplayUnitNbr`), and its
own sample-ballot site then lists that street's unit-number ranges, each tied to 1
ballot range. When a searched address falls in such a range, the service reads the
street's unit list the same way: it sends only the official street, city and ZIP to
find the street's listing number, then that number, never the house number or unit.
The answer is used for that search only and is not cached.

- A range such as `101 - 248` is inclusive and numeric. A unit counts only when its
  number, written in the digits 0 to 9, lies within it; `#250`, `Apt 250`, `Apt #250`,
  `Apt.250`, `0250` and a bare `250` all read as 250.
- A range whose 2 ends are the same text, such as `SIDE - SIDE`, matches only that
  exact unit. Between letters no order is assumed, so a letter span proves only its
  2 ends. A label in any other shape, such as `101-110` without spaces, proves
  nothing either way.
- The range's odd/even mark describes the house number, never the apartment.
- The address resolves only when exactly 1 ballot range contains the unit and no
  listed range at that house, including one with no street-table row, leaves it
  unproven. A unit outside every range, between 2 ranges or in
  2 overlapping ranges returns **We couldn’t match that address to election
  records**. So does an address with no unit at a house the source says needs one:
  no other range stands in for the missing unit.
- A failed or unexpected unit-list request, or a flagged range with no unit list, is
  a source failure: **Candidate results are unavailable**, never a no-match.
- Typing suggestions and location suggestions do not read unit lists; the unit is
  checked when the address is searched. A typing suggestion without a unit is not
  offered at a house marked for units, because it could not be searched. A location
  suggestion there prints the street address, and the card's unit field supplies
  the unit.
- An address with no unit at a marked house is refused before any unit list is read.

Measured on 9 October 2026: 100 8th Ave S, Hopkins, lists units `101 - 248`, `250 - 250`
and `252 - 663` on 3 different ballot ranges, and 439 Blake Rd N, Hopkins, splits by
floor. The dated official replies are kept in
`alethical/tests/fixtures/sos_unit_number_ranges_2026-10-09.json`.

A typed unit carries onto a suggestion only when the same base location is
established, respecting the supplied house number, street, direction, city, state
and ZIP. An uncertain match never silently drops or transfers the unit. An explicit
different unit stays visible for selection. The printed selected address and
submitted address agree; official ballot range validation still decides the match.

The connected source is [Minnesota MyBallot](https://myballotmn.sos.mn.gov/).
The supported current ballot is the November 3, 2026 general election, MyBallot
source ID `8334` (the results service uses `201`). The November 5, 2024 general
election is also retained, with results source ID `170`. These IDs name elections,
not counts of candidates. An explicit election choice stays selected. Otherwise,
choose the nearest supported upcoming election, or the most recent supported past
election when none is upcoming, using Minnesota's date.

Historical address matching requires that election's own geography. The retained
2024 source cannot establish those boundaries, so a 2024 address search says
**We couldn’t confirm the races for this address and election** and links to the
official results. It never borrows 2026 geography. Adding another election or
source capability requires reviewed evidence; elapsed time alone does not add it.

Each search reads fresh ballot records. Street tables may be reused for 5 minutes,
bounded to 32 ZIP tables and 8 MB of source text. The browser may reuse an identical
successful search for 60 seconds, with at most 4 searches held in memory. Clearing
the search or changing signed-in accounts erases these responses. Returning from a profile restores the search;
reloading or opening a new tab loses it. Initial restoration of an existing
account does not erase new input, a pending search or results from this visit.
After the account identity is established, sign-in, sign-out, account switching
and account rejection still clear and cancel private search activity.
Once a screen has drawn, a later program-download failure does not automatically
reload the website and erase this memory. A failed screen or section shows its
existing failure message and an explicit **Reload page** action; browser Back
can return to earlier results while the visit remains open. Choosing to reload
still clears candidate search memory. The shared recovery behavior is defined in
[page-load-performance-decisions.md, Recover failed downloads without losing a working visit](../operations/page-load-performance-decisions.md#recover-failed-downloads-without-losing-a-working-visit).

### Use my location

Entry offers **Use my location** beside **Find** (white, bordered, 200px wide on
computer and tablet, full width on phones). **Change address** and the homepage do not
offer it. The browser asks permission only after the tap. While it waits, the button
reads **Locating…** with a spinner in the same box and a polite announcement; the
typed text stays, and **Find** keeps working. Typing or a manual **Find** ends the
attempt, and its late reply is ignored, whichever finishes first. An attempt with no
answer after 30 seconds, for example a permission prompt nobody answers, ends as
unavailable.

A location never searches by itself. The reading's position and accuracy go once,
in a private request body, to Alethical's server, which asks Minnesota's open address
points service for nearby active addresses. A suggestion is offered only when the
reading separates 1 building from its neighbours: accuracy no worse than 100 meters,
the nearest address within the accuracy plus 30 meters, and every other distinct
address point, including one with no usable address, at least the reading's accuracy
(minimum 8 meters) farther away than the nearest. The search reaches far enough to
see those neighbours. A capped answer, an unlabelled nearest point or no nearby
address is treated as too imprecise. When exactly 1 official election street matches,
the suggestion prints the election source's spelling, so a confirmed suggestion is
compared in the same words; otherwise it keeps the state's wording.
Coordinates are never put in a link, saved in the browser, an account, analytics or
logs, and the suggestion is not kept after the attempt.

A suggestion replaces the form in place with **Is this your home address?** (keyboard
focus moves to it) and **Your device’s location can be approximate or show where you
are now, not where you live**. **Street address** is editable and prefilled.
**Apartment or unit**, marked **Optional** with placeholder **Apt 3**, is joined into
the street segment before the first comma; a bare value such as `3` becomes `#3`,
`Apt. 3` is read as `Apt 3`, and the same unit typed in both fields appears once:
`Apt #250`, `Apt 250`, `Apt.250`, `#250` and a bare `250` beside a street already
carrying `Apt #250` are all the same unit. A different number, a different label
(`Unit 250` beside `Apt 250`) or extra words are kept, and the official match then
refuses the address rather than choosing either.
**This is my home address** (busy **Finding…** in the same box) runs the normal exact
official match; Enter in either field does the same, except while an input method is
composing text, and a second press cannot submit again. Editing either field cancels
a running search, and its late reply cannot replace the edit. An empty street shows
**Enter your full Minnesota street address** in the card. Results replace the page;
no match, **Choose your address** and outside-Minnesota outcomes return to the form
holding the searched address. **Enter a different address** cancels any search,
restores the text typed before the tap and returns focus to the address box. Leaving
the page or the privacy reset ends an attempt and discards an unconfirmed suggestion.

When location cannot be used, the form and typed text stay, focus returns to the
address box, and 1 information line appears in the message area. It is not a field
error: dark text with a grey information icon, and the box is not marked invalid.

- **Location access is blocked: enter your street address**
- **Your location isn’t precise enough: enter your street address**
- **Your location isn’t available right now: enter your street address** (also after
  a timeout or a failed address-point request)
- **This search covers Minnesota addresses** (a reading outside the state)

A unit typed in the card follows the same unit matching as a typed address.

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
**Change address** selects the full address once when editing opens, with suggestions
closed until the reader edits. Later clicks place the cursor normally. **Find** and
outlined **Cancel** share a row; Cancel remains available during a search. Cancel
restores the last successful address and election, cancels unfinished work, closes
the editor, and returns focus to Change address. Escape first closes an open choice
list; with no list open, Escape does the same as Cancel.

Changing an address keeps the form open while typing, even when the draft equals the
previous successful request. Only an explicitly submitted successful replacement or
**Cancel** or Escape cancellation closes editing; a submitted recent cached result follows the same transition.
While an address search runs, both **Find** buttons show a spinner
and **Finding…** inside their unchanged box, centred the same way. A screen reader receives
1 polite waiting announcement; the line below stays reserved for errors without
repeating the waiting message. Focus stays on the activated search button, repeated
clicks and Enter cannot submit again, a search started by keyboard shows the purple
focus ring there, a search started by mouse, pen or touch does not, and a later
keyboard visit shows it again, and reduced motion stops the spinner. The
ready label returns after a result or error. Election changes keep their separate
**Updating candidates…** status.

The search button must receive the first click or tap while address suggestions are
visible. Delay dismissal of inline phone suggestions until the completed click is delivered,
so the button cannot move between press and release. Touch scrolling remains
available; keyboard focus and explicit outside dismissal keep their intended behavior.

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

A green **Candidate profile** label sits below the return link and above the whole
portrait-and-name group. It appears only with a loaded record, including joint
tickets and past elections. The name remains the main heading. **Official candidate
record** remains the card heading that separates official facts from campaign words.

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

A search saves its whole ballot together: every candidate record and accepted read in
1 database transaction, with candidate locks taken in candidate-ID order. Results return
only after every record is saved, so each profile link works at once; a failed save
returns an error and keeps nothing partial.
Evidence saved from visitor searches contains candidate records and their source
hash, not visitor addresses, coordinates, precinct names, range IDs or account
associations. The separate recheck register retains independently collected public
reference locations and is never populated from a visitor’s address search. Private
address requests bypass browser and shared caches. Source exceptions do not expose
submitted addresses. Illustrative records remain restricted to an explicitly enabled
development preview and cannot appear in production.

## People, election results and service

`/people/<id>` joins explicitly verified candidacies, supported service and official
research for 1 person. `/candidates/<id>` remains 1 candidacy, office and election;
`/legislators/<slug>` keeps detailed legislative work. Candidate records are public
before anyone claims a profile. A lost election, expired campaign or deleted
campaign account does not erase the official record.

A green **Person profile** label sits above the name on `/people/<id>`. Loading
says **Loading person profile…**; a failed read says **Person profile is unavailable**.
Neither state shows a profile label before a named record is available.

**Elections and service over time** explains **View person profile** on a linked
candidate or legislator profile. Connections need retained identity evidence,
rechecked against the candidate record. Matching names do not establish identity.
A joint governor/lieutenant-governor label stays intact; only explicitly verified
members receive separate person links. The overview returns to the exact linked
candidate or legislator when a valid return context exists.

The reviewed historical register covers 6 candidacies in 4 Minneapolis school-board
races in the November 5, 2024 election. The district's adopted canvass resolution
and meeting minutes support the certified outcomes. There are 4 verified people,
with separate district-roster evidence for service and 8 official research links.
The register also holds 7 explicit candidate/legislator connections, shown only
while their source identities match. This is scoped coverage, not a statewide
historical catalogue or a claim that every office is represented.

Ballot facts and race results keep their own sources and check dates. **Elected**
and **Not elected** require final certified results for the exact race, jurisdiction
and election stage, with retained certification evidence. A vote lead, an
uncontested race, a statewide certification for a different authority, or an elapsed
election date cannot establish the outcome. The 2026 test results feed is excluded;
no 2026 result is inferred from it. Pending, unofficial, recount, unresolved tie and
unavailable result states remain distinct. An official withdrawal needs its own
source and is not treated as a certified election outcome.

Election badges retain the explicit word **Election** so their context remains
clear on a person's profile. Colour identifies a final outcome: **Elected** is
green, **Not elected** is red with a cross, and a sourced withdrawal is grey.
Pending, unofficial, recount, tie and certified status badges are neutral grey;
**Election results unavailable** is white with a dash. Certified badges always
say **Election results**, beside **Certified {date}** when supplied or **Certified**
when the date is absent.

On `/candidates/<id>`, the status block sits beside the office facts on tablet and
desktop, stretching from the candidacy label to the party chip. On phone it sits
immediately after the office name, before the area and election date. Final
outcomes use a double solid frame; unfinished races use a single frame. The
profile withdrawal label is **Withdrew from election**; compact election rows
retain **Withdrew**. A certified race without a candidate outcome has its
certification in the source area without a large outcome block. With enlarged
text, the tablet and desktop block widens to fit its longest word, up to half the
record's width, so no status word is split across lines.

The official record's sources share 1 dividing line. Race status appears once:
in the large block when no outcome exists, otherwise in the source area.
Certification always appears in the source area. The candidate source precedes
the results source. Matching check dates share **Both checked {date}** below
both links; different dates remain under their own link. **Ballot record saved
{date}** stays under the ballot source even when dates match. A missing results
source adds no source date, and no date is invented.

Candidate profile actions use filled buttons. **Claim this candidate profile** and
**Manage this profile** are green. **View profile claim status** and
**Review profile claim requests** are black with white text, regardless of
request state. Their existing explanations, permissions and destinations remain
unchanged. An outcome never proves the person took office.
Current, elected-to, former and unknown service need their own source evidence.
Expected term dates keep their stated precision; reaching an expected start date
does not turn it into confirmed service. A retained roster does not establish a
new term after its known end. Non-legislative winners use the same person and
service records, without being labelled legislators or permanently reduced to
“former candidate.” January 1 is not a universal start date.

Official research keeps its source, date and historical versions. Research rows
load in further batches without inventing missing material.
Articles and debates remain later intake work. Campaign finance is reached through
explicitly confirmed Minnesota Campaign Finance Board committee connections,
retaining each committee and reporting period. Candidate statements are separate
campaign-authored material and never become official research.

## Claiming and managing a profile

`/candidates/<id>/claim` uses the existing Alethical account. Browsing remains public.
A profile claim requests access to manage campaign information on one candidate profile;
approval grants that access, not ownership of official records. The profile action reads
**Claim this candidate profile**, because the site also has person and legislator
profiles, and its explanation underneath is: "Alethical reviews requests from candidates
and authorized campaign representatives. Approved access lets you manage campaign
information, not official records." An approved owner sees **Manage this profile** with
"Manage your campaign’s information on this candidate profile". Claim-status and
administrator actions are black. Each explanation sits below its action, before the
footer, and the button fills the column on phone. The inactive legislator claim preview
retains its pale treatment.

Signed out with claims open, the claim page shows the grey **Go back**, **Claim this
candidate profile**, a paragraph about what a profile offers voters, **Explore candidate
profile features**, the candidate card (name, **Candidate for**, office, voting area,
election), **Sign in to continue**, and the review note under a dividing line. Signed in,
the paragraph and features link are hidden and the form follows the card. Both the top
bar's **Sign in** and **Sign in to continue** return to the same candidate's claim page.
After election day a signed-out visitor sees **Profile claims closed for this election**,
"This election has ended", **Sign in to view claim status** and **View public profile**;
signing in shows that account's saved status and never reopens new requests.

The form opens with "Alethical reviews each request. We may contact you, the candidate or
the campaign by email or phone to confirm your identity and permission to manage this
profile." It requires **Candidate** or **Authorized campaign representative**, a public
campaign or official-record link, and a private explanation of the role and how it can be
confirmed. Help under the link says a public record can confirm the candidacy but not the
applicant's identity or permission; help under the explanation asks where Alethical can
independently confirm the role. The explanation is 20–1900 characters, with separate
messages when it is empty, shorter than 20 characters or longer than 1900; the stored role
and explanation together fit within 2000. The link is at most 2000 characters and is not
fetched automatically. An invalid submit keeps every answer, shows each message under its
field, moves focus to the first invalid field and clears each message as its field becomes
valid; a second press while saving is ignored. There is no supporting upload, campaign
code check, **More information needed** workflow, automatic approval, identity upload or
required phone number. A filing, certificate, email domain or ordinary sign-in alone never
proves campaign authority.

Unsent answers are kept in memory for the same signed-in account and candidate, so a trip
to another page in the same tab returns the claim step as it was left. They are never
written to browser storage or an address, and any account change clears them. Reopening
the form after a decision or a withdrawal brings back unsent answers too. Opening a
link to that candidate's claim page in a new tab or window with the browser's own
gesture (Ctrl- or Cmd-click, a middle click, Shift-click, or the link's menu) adds a
random one-time code to that link's address after the `#` sign, a part browsers never send
to a server. The opened claim page removes the code from its address at once and uses it,
within 2 minutes, to ask the original tab for the answers over the browser's same-site
tab channel; only the tab holding that code answers, once, for the same account and
candidate. The code carries no answers and works once. The new tab accepts the answers
only while still signed in to that account with an empty, untouched form, and the original
tab keeps its own copy. A tab opened any other way, including after the link's menu was
opened and dismissed, starts empty. `/candidates/features` takes no part: the only link
to it is on the signed-out claim page, where there are no answers to hand over.

A saved pending request shows a receipt: **Profile claim request received**, an
explanation that an Alethical team member reviews it and may contact the applicant,
candidate or campaign, a note that the applicant can leave and return, and **Your
submitted information** with **Submitted {date}** (the latest submission or resubmission
from the server; older requests without submission history use their creation date, and a
missing date is omitted). The saved answers show **Your role** only when the stored value
starts with an exact role name and 2 new lines; anything else shows whole as **Your
explanation**. "This information is not shown on your public profile" sits under them.
**View public profile** and **Withdraw request** follow. Submitting again opens the saved
request without changing its evidence or sending another notification (**Request already
submitted**). Not approved, withdrawn, revoked, already claimed, election ended and admin
states each have their own heading and next step: **Request another review** after a
decision, **Start a new request** after a withdrawal, **Request a review** on a profile
another account manages, and none once claims close. Applicant and voter wording says
"Alethical"; only admin screens name the administrator role. No applicant-facing
rejection reason exists; private review notes are never shown to applicants or emailed.

`/candidates/features` explains what a claimed candidate profile will offer. Every
feature on it is on the roadmap and the page says so; none is available yet. Twelve
features sit under 4 headings (**Who you are**, **Questions and answers**, **Keeping
voters informed**, **Public records and your team**), followed by a **How it works** card.
Reached from the claim page, the address carries only the public candidate id; a card
under the introduction shows the candidate's name and office beside **Continue claiming
this candidate profile** (no card once that election has ended), and **Go back** returns
to that claim step. A direct visit has
no candidate name or claim action, **Go back** falls back to `/candidates`, and the page
ends with **Find candidates**. The page has no comments, rankings, promise scores,
donations, follower lists, paid placement or prices. The plain `/candidates/features`
address is an ordinary public page that search engines may list; an address carrying a
candidate is kept out of search results and names no candidate in its first response.

Only an active account with a current confirmed email can request campaign access.
There is 1 administrator role, with equal review powers. Admin accounts cannot
claim profiles or manage statements as owners, including through a direct address
or a previously approved claim. The admin action on `/candidates/<id>` is
**Review profile claim requests**. Public voters have no approval controls.

The private `/admin/candidate-claims` list has **Pending** and **All**, candidate
filtering, exact request links and 25 rows per page, oldest-created first. Its
pending count includes requests from ended elections. The open account menu
shows the count beside **Profile claim requests**; it is not a public site badge.
An exact request, headed **Review profile claim request**, shows the applicant email
with **Email confirmed** only when the current confirmed address is unambiguous (otherwise
"No confirmed account email available"), **Submitted**, **Role** (only from an exact
prefix), **Campaign website or official record**, **Explanation**, the official record
source and check date, the private review note and **Request history**. History uses short
event names, and each submission's own saved answers sit behind **View submitted
information**; an older submission is never shown with the current values. A historical
missing role or event is not invented.

An admin independently confirms identity and campaign authority, checks the
approval confirmation, and saves a private note of 20–2000 characters before
approval; the note shows a live count. Any approval block sits directly above
**Approve request** and **Reject request**, in this order: ended election, an existing
approved claim, the applicant's account (admin, deactivated or unconfirmed email), then
the official record checks. An unconfirmed applicant email blocks approval and leaves
rejection available. Approval requires an active confirmed non-admin applicant, no other
approved owner, and official evidence checked within 24 hours. **Reject request** and
**Revoke profile claim** also require a private note. Competing
requests never transfer ownership automatically. There is no assignment or second
admin role: the saved request version prevents an older screen from overwriting a
newer decision. An unknown save outcome requires reloading the request before retry.

**Recheck official record** fetches real official evidence outside database locks,
then rechecks admin eligibility, request version and the exact saved candidate
before saving only that matched record. Its independent public reference register
covers 112 current candidate IDs, not every possible candidate. A missing reference
or temporary source failure does not advance the check date. A proved identity,
election or missing-candidate mismatch blocks new requests and approvals until a
successful matched recheck clears it; temporary failures retain any existing block.
A merely old record asks for a new check. A mismatched record says **The official
candidate record could not be confirmed, so this profile claim request cannot be
approved**. Existing approved non-admin owners retain statement management.

New requests and approvals close after election day in **America/Chicago**, without
waiting for results certification. Existing pending requests retain their private
status and withdrawal action. Rejected, withdrawn, given-up and revoked applicants
can request another review while new requests are open and account/source checks
allow it. An already-claimed profile does not promise a transfer; another request
still needs admin review. Closed-election public states explain what a profile
claim means and show no new-request button.

An approved owner uses `/candidates/<id>/manage` for a plain-text statement of at
most 2000 characters, including after the election. The page opens with **Go back** and
**View public profile** (both ask before discarding unsaved edits), "Manage the campaign
information voters see on this profile. Official records are shown separately and can’t be
edited here.", and the candidate card with **Campaign access verified**. Under the editor,
the left side shows **Published {date}** or **Edited {date}** once a statement is public,
or "Your statement is not saved until you publish it" before the first publish; the right
side shows a live "{n} / 2000 characters". **Save changes** appears only after the text
changes; voters keep seeing the published version until saving succeeds. Every write,
including **Try again**, refuses more than 2000 characters and an empty first publish,
focusing the editor; saving after deleting all the text asks the same "Remove your
statement from the public profile?" question as **Remove statement**, on the first press
and on **Try again**. **Try again** first reads what was saved, then repeats only the last
action and only if it is still needed; a failed removal is retried as a removal, never as
a save, and the owner's text is never changed. **Try again** first confirms the account still manages the profile; if access has ended,
the page shows the current access state, clears the editor and sends nothing, and a write
refused for lost access does the same. If the statement was saved somewhere else since the
failed attempt, **Try again** sends nothing and says "The published statement changed
elsewhere. Your changes are still here and have not been saved.", shows the statement voters
now see, and keeps the owner's text in the editor; only a fresh **Save changes** replaces
the published statement. Preview shows the public card, with the same spacing, without the
report link. Campaign statements stay out of official-record answers and search material
used by Grounded Ask. Private statement revisions remain available to the owner and
authorized admin review.

The public card leads with **Campaign statement** and the campaign's own words, dated
**Published {date}** for the first publication or **Edited {date}** for the latest saved
edit, never an election, certification or check date. A removal followed by a new
statement is a new publication. **Published** is shown only when the owner's revision history proves
when the current statement was first published: the history is complete, or a recorded
removal comes before it. For an older statement saved before its history was kept, an
edit is never dated as a first publication; **Edited** still appears once a second edit
is recorded, and otherwise no date is shown rather than a guess. One quiet line beside **Report this statement** says
"Alethical verified this account’s authority to represent the campaign, not the
statement’s accuracy". A failed statement load shows "We couldn’t load the campaign
statement" with **Try again**, which reloads only the statement and keeps its box steady;
a successful response with no statement shows nothing.

An unsaved statement stays in the editor until publication or a confirmed edit;
there is no saved unpublished-draft feature. Leaving through an in-app link or
browser Back or Forward offers **Keep editing** and **Discard changes**. Keeping
the draft restores its text and keyboard focus. Closing or reloading the tab
uses the browser's own warning. A never-published draft has no publication date,
including in Preview. Clearing an existing published statement is an unsaved
edit; typing and clearing a new draft back to empty is not.

Applicants can withdraw pending requests with **Withdraw request**. **Give up this
profile claim** ends an approved owner's access and removes a published statement if
present. Its confirmation, **Give up this profile claim?** with the candidate's name,
mentions removal only when a statement is published and warns about unsaved edits only
when there are any; **Keep profile claim** and Escape keep every edit and return focus.
Removing a statement says voters will no longer see it and that access is kept.
The saved claim state remains withdrawn, but new history distinguishes **given up**
from an ordinary withdrawal. Revocation also removes a published statement if
present. None of these actions removes the official candidate profile.

Private history records 7 events: submitted, resubmitted, withdrawn, given up,
approved, rejected and revoked. Every new event retains its own evidence and note.
The latest submission date comes from a submission event, not a later decision;
legacy requests retain their original creation date when later history is absent.
History says when earlier events are unavailable rather than recreating them.

Updates carry the expected account and saved version. Same-account sign-in refresh
preserves unsaved text; sign-out, account switching or lost permission clears private
responses and text. Revocation, giving up, deactivation and account deletion remove
the public statement from subsequent reads. Deleting a requesting account removes
its private claims, statement revisions, claim events and queued deliveries.
Deleting a reviewing admin removes that actor's account reference from retained
history instead of copying their private identity permanently. Official people,
candidacies, service, research and results remain independently retained.

## Profile claim email notifications

There are 8 message variants: new and resubmitted requests to eligible active admins,
and approval, rejection and revocation separately to the applicant and to other
eligible active admins. The deciding admin is excluded from the admin decision
notification. Messages go individually to current confirmed account addresses,
never a public campaign address or an exposed recipient list. Ambiguous current
addresses are skipped instead of choosing one.

Resend delivers from **Alethical <ask@alethical.com>**, with replies to
**ask@alethical.com**. Messages identify the candidate, office, voting area and
election, and no message line repeats its subject. Admin request messages say "Ready for
review"; applicant messages say "You can now manage your campaign’s information on this
candidate profile", "View your profile claim status for available next steps" or "You can
no longer manage your campaign’s information on this candidate profile", with the reminder
"Sign in with the account you used to request access". Admin decision messages have no
message line and name the decision, retained reviewer and saved time. Private supporting links, explanations, review notes and reports stay
out of email. Admin links open the exact private request; applicant links open the
matching profile status or management view after sign-in. An old approval link
cannot restore revoked access.

The request or decision, history event and intended notifications save together.
Delivery runs afterward and rechecks current recipient eligibility before sending.
A delivery failure does not undo the saved decision. Each event/account pair has
1 delivery record; retries use the same attempted message and delivery key. An
uncertain send stops retrying after 23 hours and clears its prepared private
payload. Deleted or ineligible recipients are cancelled, and test-recipient
restrictions are checked again immediately before delivery. Feature and general
email switches keep live sending disabled until the release checks allow it.

Readers can report a published statement. Admins receive the reason and the exact text
and version reported, even if the campaign edits it before review. Reports and verification
notes are private. Database failures return a generic unavailable response without
passing private notes into server error logs. Public report submission is rate limited and sends no email.
The browser submits the statement version shown. A live "{n} / 2000 characters" sits
under **Reason**. If the statement changed, the reason stays and "The campaign statement
changed. Review the updated statement before submitting your report." appears with
**Reload statement**. Reloading opens an **Updated statement** panel above **Reason**
with its date, moves focus to it, and never submits; **Submit report** needs its own
press, and a further change shows the warning again. A failed reload says "We couldn’t
load the campaign statement" and keeps **Reload statement**. A removed statement cannot be reported. Rate-limit recovery uses the
server's actual wait and restores submission without a page reload.

## Later work

Candidate-specific paid services remain a later phase. This release does not add prices,
checkout or service offers inside claimed profiles. It does not introduce promise tracking
or promise-versus-vote scoring.

The [candidate lookup build and release plan](../implementation/candidate-lookup-build-plan.md)
records source evidence, tests and release history.

The shared address field keeps suggestions closed after the external **Find** button
submits, including when loading ends or a returned address changes the field. New
editing or fresh field focus enables suggestions again. Escape then Arrow Down
continues to reopen existing choices without changing the typed text.
