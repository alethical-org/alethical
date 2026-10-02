# Candidate design build acceptance inventory

Status: coverage accepted by the parent implementation owner on October 1, 2026 after independent comparison of build-facts sections, match-design items and the profile drawings, plus the search builder’s direct search-drawing comparison. The target tables retain the starting-code observations; the acceptance evidence below records completed checks and explicit limits. Local, hosted and live acceptance are complete, including the final court-label follow-up.

## Accepted inputs and scope

- User authorization: “set. build through live deployment without stop”; public candidate search, public candidate profiles and homepage candidate-search copy. User explicitly approved the newer, higher arrow position.
- Source: `/Users/eug/Downloads/Alethical UX (51).zip`, SHA-256 `f2feabf5f778d6852679930ddce7ad7d9253f2cba8e7e8c1fba373c20c715365`, extracted at `/tmp/candidate-design-review/package51`.
- All 8 source files reviewed: `Candidates search.dc.html`, `Candidates profile.dc.html`, `Candidates claim.dc.html`, `Candidates manage.dc.html`, `build-facts-candidates.md`, `match-design-candidates.md`, `copy-proposals-candidates.md`, `review-prompt-candidates.md`.
- Acceptance owner: `docs/design/design-principles.md`, “Build acceptance for controls”. Inventory must be independently accepted before affected implementation, then every required row needs actual behavior/visual evidence or an explicitly approved exception. Reused shared controls remain in scope for review. Final independent review starts from the handoff, not just this checklist or the code changes.
- Claim/manage drawings are context only. `copy-proposals-candidates.md` excludes their redraw from this round. Public profile account controls, campaign statement, reporting and correct navigation to existing claim/manage screens ARE in scope. Do not introduce the old drawing's email-code or uploaded-record verification workflow. Preserve real staff-reviewed access and existing security boundaries.
- Homepage copy is expressly authorized by the user even where the review prompt excludes homepage work. Do not silently expand that into a homepage interaction redesign.
- Actual production address disclosure must name Minnesota government services, including the Minnesota Secretary of State and Minnesota mapping services as applicable. Census language in illustrative drawings is not permission to misstate production processing. Preserve source-injected truthful disclosure.
- Current source capability controls production states: do not invent a primary election, official seat counts, missing named offices, portraits, service history, individual members of a joint ticket or legislator identity matches. Use controlled fixtures for conditional drawing acceptance, and mark fixture-only evidence.
- No new paid services, unrelated navigation rewrite, sitewide arrow replacement or claim/manage redraw is authorized by this inventory.

## Shared visual and interaction target

Source abbreviations: S = `Candidates search.dc.html`; P = `Candidates profile.dc.html`; BF = `build-facts-candidates.md`; MD = `match-design-candidates.md`; CP = `copy-proposals-candidates.md`. Each requirement applies to all relevant roles/states unless the row narrows it.

| ID | Target | Starting code / acceptance evidence needed |
|---|---|---|
| G01 | Layout bands below 768, 768–1099, 1100+. Drawings at 390, 900, 1280. Inspect narrow width and enlarged text as well. Preserve drawn typography, colors, hierarchy and section order. | Screenshots at all 3 bands, plus narrow/200% text; no horizontal overflow or clipped focus. |
| G02 | Libre Franklin, equal-width digits for numbers per saved product rule. White cards; page `#fbfcfd`; ink `#11150f`; secondary `#4f5651`; green action `#2ed47e` / `#06231a`; neutral party `#f1f1f4` / `#4f5651`; amber `#fdf6e7` / `#efd9a8` / `#8f5a12`; error `#a3421a`. | Measure actual rendered fonts, sizes, colors; review marks, amber copy-review underlines and state switches never ship. |
| G03 | Every button/link target at least 44px. Keyboard-only control focus 2px purple `#7c5cff`, offset 2; text fields retain typing focus on pointer/touch. Focus rings fully visible. | Tab, click and touch separately; no mouse-created keyboard outline on ordinary buttons/links, no removed field focus. |
| G04 | Hover follows each named control's approved treatment, only when hover is available. Press feedback distinct; disabled/busy controls cannot advertise another action. Busy button width, height, location remain steady; reserve predictable feedback and allow errors to grow. | Actual hover/pressed/busy measurements for all controls listed below; slow and immediate completion. |
| G05 | Preserve shared sitewide geometry: forward arrow19px, established `M3.5…` path and stroke1.8; back18px chevron with9px gap. Apply only the approved newer higher candidate inline-arrow position from eug-17. Word hover is `#11832b` and underline on words only; arrow and last word stay together. | Parent resolved the source reconciliation: Design recommends eug-17 alignment with shared geometry. User “yes newer arrow position” approves height, not new path/stroke or mirrored back arrow. Existing diagonal external candidate arrow needs the shared forward treatment. |
| G06 | External links open real official destinations in a new tab and announce this accessibly. Internal links use same-tab app navigation. Never invent URLs from labels. | Inspect actual destinations and return paths, not merely clickability. |
| G07 | Reused header: desktop full navigation; tablet/phone drawer and green Sign in; menu hit target 44 with 38 visible square. Footer includes Contact us at every width alongside Privacy Policy and Terms. Phone copyright differs as drawn. | Browser open/close menu, focus return, header/footer routes, hover, touch. Reuse does not waive checks. |
| G08 | Interface punctuation: prefer a clean single sentence/line without ending period. Messages with multiple sentences end every sentence with a period. Count sentences, not wrap lines; preserve source quotations. | Sweep rendered strings across ready, error, loading, report and account states. Exact build corrections recorded in design update notes. |

## Search entry and homepage copy

| ID | Role / start / action | Expected result and source | Current gap / verification |
|---|---|---|---|
| S01 | Visitor, direct/menu `/candidates` | Empty form, no account requirement. Heading and button “Find my candidates”. Support “See who’s running where you live in Minnesota, with candidate profiles linked to official records”. S/BF. | Existing heading/button capitalization and support differ. Compare text and order at 3 widths. |
| S02 | Visitor, homepage search block | Exact approved support: “Explore the candidates in your Minnesota races, with links to official records”. Keep heading “Who’s running where you live?” and existing homepage behavior. Preserve truthful injected privacy disclosure. | Replace the old “Enter your Minnesota street address to see who is running for office in your area” support. Parent has reconciled the exact homepage copy. |
| S03 | Visitor, homepage handoff | Typed address carried in temporary memory, `/candidates` address bar stays clean. Drawn arrival has populated field and finding feedback. Direct visits remain empty. | Existing homepage waits for search before navigating; scope is homepage copy, so report any timing difference explicitly rather than silently broadening. Verify actual route handoff and no address in URL. |
| S04 | Visitor, entry layout | Desktop max1168, remaining-width form +300 outline, gap64; tablet200 outline/gap40; phone160×176 decorative outline centered below the address notes with40px above, superseding the beside-title outline under the user's October2 isolated mobile change. H1 48/42/32; lead19/18/16.5; page top padding64/48/32, superseding S's36/32/24 under the user's October1 live-review correction. The same outer padding applies to results. Input/button top-aligned; desktop button248, tablet220, phone full width, height60. S plus explicit user correction. | Existing entry cap1080/form700/gap80 and map placement differ. Decorative outline excluded from accessibility tree. |
| S05 | Visitor, street field typing/paste | Label “Full street address”; placeholder “350 S 5th St, Minneapolis, MN 55415”. 60px minimum, radius14, font17. Grow for wrapped text without an internal scrollbar or clipping. Pasted line breaks become spaces; Enter picks/submits, no inserted newline. | Auto-growing textarea exists but paste normalization/IME guard need attention; compact height currently52. Check long address and composed text. |
| S06 | Visitor, submit ready/busy | Search icon changes to spinner with “Finding candidates…” inside the same button. A hidden polite live region announces once; no visible repeated busy line. Entry248/220/full width×60; Change address full width×52. Field remains editable, repeated pointer/Enter submission guarded, activated button keeps focus with aria-disabled and progress cursor. 22px minimum error space at12px below (10px for compact). | Current stretch alignment can change button height with textarea. Measure ready/busy/error. |
| S07 | Visitor, helper/disclosure | Hairline36px after feedback,20px before helper; 14px/21px gray lines with6px gaps. City/ZIP limitation, actual-service privacy disclosure, and actual-service attribution only. Field described-by includes help. | Existing helper position/sizes differ. Census fallback cannot replace production Minnesota-service wording. |
| S08 | Visitor, suggestions after supported typing | 6-character start; singular/plural heading. Desktop/tablet overlay8px below field; phone inline under field. Up/Down wrap; Enter select; Escape close with draft preserved and field focus retained. Accessible active descendant. | Exercise existing behavior plus phone keyboard, field visibility, suggestion reachability. Suggestions failure must not prevent normal submit. |
| S09 | Visitor, ambiguous submitted address | “Choose your address”, explicit listbox selection with Up/Down/Enter/Space/click; no silent choice. Escape returns to field. | Existing listbox must survive visual updates; test multiple returned matches. |
| S10 | Visitor, missing/no-match/outside/limited/lost | Exact strings: “Enter your full Minnesota street address”; “We couldn’t match that address: check the street address, city, and ZIP code”; “This search covers Minnesota addresses”; “Too many searches: try again shortly”; “Enter your address again to find candidates”. Finding: “Finding candidates…”. | Existing mixed sentence ending differs. Missing/no-match/outside mark field invalid; rate limit is amber clock feedback, not invalid-address feedback. Retain draft in every failure. |
| S11 | Visitor, phone on-screen keyboard | Field label stays visible; suggestions and submit reachable; error wrapping grows normally. | Actual keyboard/viewport behavior required, not established by drawing. |
| S12 | Visitor, new tab/reload/privacy boundary | Address remains temporary, excluded from query strings, browser saved storage, analytics, logs and accounts; privacy boundary clears flow/cache. | Existing flow uses private memory; preserve while adding group/scroll state. Inspect storage/network payload scope safely. |

Entry drawing coverage: empty; homepage finding; suggestions and phone keyboard; ambiguous; missing; no match; outside Minnesota; rate limit; address lost. Each needs observation or clearly labeled controlled-state evidence.

## Search results, election selection and state retention

| ID | Role / start / action | Expected result and source | Current gap / verification |
|---|---|---|---|
| S13 | Visitor, first successful results | Confirmed address/map icon and underlined Change address, election selector, Coverage, then race groups. Desktop360 sidebar +remaining race column/gap48; tablet/phone single column with30/26 gaps. H1 34/32/28. | Existing layout/order has differences; capture all bands. |
| S14 | Visitor, Change address | Focus filled field; “Showing results for {address}” remains above form and old list remains during editing/loading/failure. Escape closes editor. Successful replacement changes everything together. | Existing editor replaces old address, and address feedback is duplicated elsewhere. Check failed new address never relabels old races. |
| S15 | Visitor, election selector open | Drawn custom menu with 2-line name/date, chevron, selected check. Up/Down, Enter/Space, Escape and Tab work; focus stays/returns to trigger. Only actual available elections. | Current option layout is single-line and chevron is a text glyph. Open-menu screenshot and keyboard sequence required. |
| S16 | Visitor, primary selected | “Not every office has a primary”,14.5px gray,8px below,12px inset. Groups follow official primary records, never our candidate-count rule. | Missing current note. Production may have no current primary; fixture-only evidence labeled. |
| S17 | Visitor, new election loading | New requested election selected immediately. Old usable rows/counts/source/date/links retained full strength. “Updating candidates…” and “Showing results for {election} · {date}” under selector above Coverage, also at desktop race column as drawn. Announce busy. | Current wording/location differ and redundant election rows appear. No blank flash, footer collapse or wrong-label intermediate state. |
| S18 | Visitor, election replacement fails | “We couldn’t update the results”, previous-results identity and Try again for requested election; old list remains usable. | Exercise failure/retry, rapid choices, older response arriving last. |
| S19 | Visitor, first results request fails | “Candidate results are unavailable” and Try again; no misleading Coverage/no-candidates screen. | Distinct from old-results failure. |
| S20 | Visitor, no upcoming election records | “Records for upcoming elections are not available yet” and official sample-ballot link; no election menu or silently selected old election. Keep address flow reachable. | Current wording and form-hiding differ. |
| S21 | Visitor, cached revisit/rapid switching | Existing memory cache remains bounded and fresh: actual flow currently4 exact requests for60s, never caches failure; newest request alone can replace display; clear across privacy boundary. | Keep existing generation/abort safeguards. Test cached repeat, rapid selectors, retry, out-of-order responses and cancellation. |
| S22 | Visitor, candidate then back | Restore address, election, displayed results, group open/closed state and useful scroll position from temporary memory. Direct candidate entry must not manufacture a stored search. | Current flow stores request/data but lacks group state. Test in-app back and browser back. |

Results drawing coverage: full; replacement loading; replacement failed; first load failed; primary; no upcoming election; source-stale; editing address; edited-address no-match with old list retained; named coverage gaps. Do not fake production availability to make every drawing reachable.

## Coverage, groups, races and sources

| ID | Role / start / action | Expected result and source | Current gap / verification |
|---|---|---|---|
| S23 | Visitor, coverage panel | “Coverage for this address”; always candidate-list disclaimer and official Minnesota sample ballot information link. Generic “Some local offices may be missing” has no invented named office/source link. Named unmatched district and unavailable records only from explicit supported data. | Current generic gap still attaches an authority link; preserve distinctions between no filings, unknown district, missing source and request failure. |
| S24 | Visitor, incomplete coverage | Exact supported labels: “We couldn’t confirm your district for {office}”; “Candidate records are unavailable for {office}”; actual authority source. Omit affected race, do not show an empty candidate list. | Test generic-only and named fixtures separately. Group absence alone is not evidence of missing records. |
| S25 | Visitor, group navigation | Fixed order State, County, City or township, School board, Other local offices; only groups with races. Jump labels State, County, City or township, School board, Other local; accessible full group name. No selected-filter treatment. | Current heading “Other supported local offices” and no jump controls. One desktop/tablet row; wrapping phone. |
| S26 | Visitor, jump buttons | 44px minimum, padding0 16,radius12,font15.5 bold,10px swatch/r3,8px gap. Hover/press preserve each group's color family; keyboard purple. | Click closed target opens and scrolls24px clear, focuses heading button; reduced-motion immediate. |
| S27 | Visitor, section bar open/closed | Full-width h2 button,min60,padding10 16,r14;14px swatch/r4; heading28/26/24 weight800; count16bold remains visible;20px chevron up-open/down-closed. aria-expanded/controls; group gap32. | Entire collapse/count treatment absent. Keyboard toggle, touch, long heading/count fit. |
| S28 | Visitor, state persistence | New address opens all 5 available top-level groups; election change/back preserves choices. Browser find finds hidden content and opens group. Printing expands all groups. | Implement memory state and hidden-until-found/beforematch or effective equivalent; inspect print output and native browser find. |
| S29 | Visitor, Judges nested group | Last inside State, h3/min56, default closed for new address; no top jump. State count includes judge races. Light State panel/r14;12px hollow square; title21/20/19,count15,18px chevron;cards12px inset/8phone,12gap; race titles h4. | No current subsection. Preserve state on election/back; nested search/print reopening; court order Supreme/Appeals/District then numeric seat. |
| S30 | Visitor, ordinary race | Office18 bold, geographic area, positive official “1 seat to fill” / “{N} seats to fill” only general elections; no ordinary candidate count. | Current “Elect N”. Do not guess count1 from one candidate or remove metadata simply because only one candidate. |
| S31 | Visitor, joint ticket race | One unsplit source-supplied ticket label, party once, one View profile for shared official candidate record. “1 ticket listed”/“{N} tickets listed”; “Each ticket is a pair who run together. You vote for 1 ticket.” No seat label. | Current members split into two links/assumed roles; this is a material data-shape change to remove guesses, not a visual-only label change. |
| S32 | Visitor, candidate row | Minimum64; source-supplied name, neutral party when known, View profile with accessible person/ticket name. Alphabetical by full supplied label. | Current sortName/member-first logic can guess last names. No photos, biography, claim status, winner/unopposed inference on search. |
| S33 | Visitor, official zero filings | “No filed candidates listed” and “The available filing records list no candidates for this race”. | Keep distinct from missing data and failed requests; existing strings mostly present. |
| S34 | Visitor, source formatting | Known nonpartisan displayed “Nonpartisan”; judge format “Judge, 9th District Court, Seat 12” / “9th Judicial District” when supported; full month dates. | Current candidateDate abbreviates month; format from actual fields, never create nonexistent seat/district. |
| S35 | Visitor, shared source line | Once under group when authority, actual URL, checked time and stale status truly match. Otherwise affected race gets its own line. “Candidate records from {source}”, “Checked {date}”, “May be out of date”. | Current sources per race/old wording. Do not borrow newest check date or stronger coverage. Shared visual placement depends on equality of facts, not matching words. |
| S36 | Visitor, source-stale search | Use search response's stale condition. Clock-warning treatment follows drawing. Profile's saved-record24h rule is separate. | Do not make all illustrative historic search dates stale because today changed. |

Group colors (tint / edge / square / pressed): State `e8f6ee/a8dcbf/15834a/d6efe1`; County `e4f4f4/9dd1d1/147372/d2ebeb`; City or township `eff3e0/c6d49b/5f7a14/e2e9c8`; School `f0ecfb/c8bcef/6a50c4/e3dcf7`; Other `f3f0ea/d4cbbc/7a6a52/e8e2d7`. Preserve the drawing's hover state separately from these pressed values.

## Public profile identity, portrait and official record

| ID | Role / start / action | Expected result and source | Current gap / verification |
|---|---|---|---|
| P01 | Visitor, valid profile | Back/find → portrait/name → legislator panel when known → official candidate record → campaign statement when available → account action → footer.760px max; padding40/32/20;top24/22/16;name44/40/32. | Current name48/34 and identity outside record; whole profile restructuring needed. |
| P02 | Visitor, entry from search/direct | Search entry “Back to candidates” restores search; direct entry “Find my candidates” opens empty search. Back stays reachable in loading/unavailable states. | Current always Back. Test cold URL, refresh, app back and browser back. |
| P03 | Visitor, confirmed portrait | Real confirmed image beside name, entire image with its own ratio; width120/112/84,gap22/20/14,1px edge. No crop/circle/retouch/link or substitute illustration. Credit12 only when supplied/required. | Profile types/rendering currently have no portrait. Sitting legislator image may be used only for confirmed same person. Credible data source and valid URL required. |
| P04 | Visitor, portrait loading/failure/missing | Loading holds image-sized space with drawn light placeholder; failure/missing cleanly omit image/frame, no broken symbol or empty permanent box. | Exercise successful, slow and broken image with long name. Joint ticket does not receive a misleading one-person hero portrait. |
| P05 | Visitor, confirmed legislator connection | Near name, visible without opening anything. Existing same person's `/legislators/<slug>` link labeled “View legislator profile”; support “See their bills, votes, and work in office”. Panel white1px/r14,no shadow,padding18 20 8 /phone16 16 8. | No current connection data/rendering. Never match by name alone. Existing API must supply grounded association or no addition. |
| P06 | Visitor, current legislator seeking other office | “Currently serving as”, confirmed office/district and optional verified tenure; candidate record separately says “Running for” office sought. | No implication candidate already holds sought office. Panel office17bold,area16. |
| P07 | Visitor, confirmed reelection | “Running for reelection” only same office AND district and confirmed current service. Shared office/district printed once, panel keeps support/link/source. | Do not infer reelection from merely having legislator profile. |
| P08 | Visitor, former or unknown service | Confirmed former: “Formerly served as” with supported office/dates. Confirmed same person but service status unknown: link/support, no current/former claim. No connection: omit cleanly. | Test all three independently. Legislative session dates are not personal tenure. |
| P09 | Visitor, ticket with linked member | Legislator panel names the matched individual, optionally64px portrait inside panel, then their service facts/link. Ticket source name remains unsplit. | Do not suggest both ticket members share a legislator record. |
| P10 | Visitor, legislator source | Own panel footer “Service records from {source name}”, real official person URL; plain text if absent. Independent checked date only if known. | Filing source cannot silently establish current service or picture identity. |
| P11 | Visitor, official candidate record | White1px/r16 card, drawn shadow,34px green building icon and title “Official candidate record”. Office20/19/18;h2 21/20/19;body17/17/16. | Current title already “Official candidate record”; old rows and outside identity still differ. |
| P12 | Visitor, record identity/date | Running for, Running for reelection or Candidate for after Minnesota election day has passed; office, area, election/date, known party, campaign website inside record. | Past-election language does not imply winner/loser. Test time-zone boundary and unknown election metadata. |
| P13 | Visitor, official website | “Campaign website” and actual readable domain link, correct destination/new-tab behavior. Omit if absent/untrusted. | Current separate website card/generic CTA+URL repetition. |
| P14 | Visitor, source footer | “Candidate records from {source}”; “Checked {full month date}”; “May be out of date” for saved profile older than24h. Fresh successful matching search may update stored record; opening profile alone must not refresh its check date. | Current old “Records checked” wording. Needs actual saved time rather than current render time. |
| P15 | Visitor, record loading/unavailable/unknown | Loading distinct; unavailable clear error and Try again; unknown profile genuine not-found state with recovery. Other independent content does not become a false official record. | Existing loading/error/404 need drawn presentation and top back/find. Controlled state evidence required. |
| P16 | Visitor, removed old material | Remove filing-name/date/filed-with rows, Report a record error, duplicate public-record card, separate campaign-site card and invented running-mate details. | Do not delete actual campaign statement reporting; it is a separate action. |

Profile person cases: reelection; current/different office; former; same person/service unknown; portrait without legislator connection; no portrait/no connection; joint ticket; past election; long names/offices. Cross-check useful combinations with portrait loaded/loading/failed; record ready/old/loading/unavailable/unknown; entry search/direct.

## Public profile campaign, account and report controls

| ID | Role / start / action | Expected result and source | Current gap / verification |
|---|---|---|---|
| P17 | Visitor, campaign statement published | Gray `#f1f2f4`/r16 card; heading and white “Written by the campaign, not Alethical” chip; “Published {date}”; shield “Campaign access verified”; “Alethical confirmed this account’s authority to manage campaign content”; white statement area preserves author paragraphs. | Existing candidate-name · Campaign and bare date duplicate meaning. Preserve source-authored statement content exactly. |
| P18 | Visitor, no/removed/failed statement | No/removed omit card. Request failure says campaign content unavailable with outlined Try again; official record remains visible. | Failure is not no statement. Public getter already no-store/credentials omit; preserve. |
| P19 | Visitor, report action | “Report this statement” underlined neutral text without arrow inside campaign card footer aligned as drawn. | Current report placement differs. 44 target, hover, focus and touch. |
| P20 | Signed-out/unclaimed visitor | Outlined “Claim this profile”,48px, plus “For candidates and authorized campaign representatives”; inline desktop/tablet, stacked/full-width phone. Correct existing claim destination and return. | Current green link/arrow, helper absent. This changes public entrance only, not claim workflow. |
| P21 | Approved owner / pending claimant | Green “Manage this profile” / outlined “View claim status”, correct existing candidate/account-specific destination. | Current links differ. Account/permission changes must not expose another account's controls/data. Preserve approved admin functionality without importing unrelated drawing. |
| P22 | Visitor, account loading/failure | Stable48px action row. Spinner “Loading profile access…”; failure “Profile access is unavailable” plus outlined Try again. | Current states exist but geometry differs. Test slow/fast/error/retry and auth transition. |
| P23 | Visitor, report opens | Title “Report this statement”;44px Close X; max520; desktop radius18,padding20 28 28,top90; phone bottom sheet/radius20 20 0 0,padding22 22 28. Focus Reason; trap Tab; Escape/Close returns report-trigger focus. | Existing dialog max460/Close text, no visible-viewport scrolling. Scope shared-control changes so excluded claim/manage screens do not accidentally redraw. |
| P24 | Visitor, report editing | Label Reason; “Up to 2000 characters”;textarea16/24,grow216–432 desktop/tablet,168–264 phone then scroll internally. Dialog fits visible viewport/keyboard, submit reachable. | Existing multiline220 and maxLength truncation. Do not silently discard pasted excess text. |
| P25 | Visitor, blank/too-long report submit | Submit enabled before validation. “Enter a reason”; “Shorten your reason to 2000 characters or fewer”; invalid/described-by and focus recovery, all entered text retained. | Current blank disabled and maxLength prevents drawn too-long state. |
| P26 | Visitor, report submitting | “Submit report” fixed label/48px/190px desktop-full phone, spinner; reason read-only, duplicate submit blocked; close prevents late updates from reopening dialog. | Current transition must be measured; immediate/slow cases. |
| P27 | Visitor, report failure/retry | “We couldn’t submit your report”; Try again same button box; preserve reason. | Existing generic failure needs drawn message/layout. |
| P28 | Visitor, report rate-limited | “Please wait before reporting again”; preserve reason; respect actual server wait; retry restored without page reload when wait ends. No invented wait/countdown. | Actual report route returns429 with real Retry-After; public API parsing already exposes Retry-After. Wire that real value to recovery, then test elapsed wait. |
| P29 | Visitor, report success | One “Report received” green confirmation, no repeated success heading/body. Close works and returns focus. Report private; no email promise. | Current repeated success; inspect actual backend snapshot semantics. |
| P30 | Visitor, report content identity | Send the displayed statement’s expected_version. A409 shows “The campaign statement changed: reload it before reporting”. Reload action retains reason and fetches latest statement before another report. Handle removed statement distinctly. | Backend expected_version guard is now implemented and rejects mismatches before saving. Public UI/transport must complete this behavior; test concurrent statement change without filing a report against unseen text. |

Account state coverage: public, approved owner, pending, loading, failure. Campaign state coverage: absent, published, removed, failure. Report coverage: closed, open, blank error, too-long error, submitting, success, general failure, rate limit, wait elapsed. Exercise real browser actions with controlled safe service responses; do not submit a real production report merely as a test.

## Observed starting-code map

- `apps/frontend/src/components/candidates/CandidateControls.tsx`: abbreviated dates, old source wording, diagonal external arrow, older link alignment. Check hover/press/focus and fixed busy sizes across all public uses.
- `CandidateAddressForm.tsx`: older placeholder/copy, field/button height behavior, pasted-newline handling, error treatment. Existing suggestions/listbox and textarea growth should survive.
- `CandidateSearchContent.tsx`: old title/support/layout, missing primary note, outdated no-election wording, change-address identity placement, menu and updating/error presentation.
- `CandidateResultsContent.tsx`: absent color jump buttons/collapse bars/counts/Judges, sources repeated by race, old seat metadata, split ticket assumptions and per-member links, old Other title and sorting.
- `CandidateProfileContent.tsx`: old identity/filing card layout, no portrait or legislator panel, separate website/running-mate blocks, no direct-entry distinction.
- `CandidateProfileScreen.tsx`: load/error/not-found integration must carry entry mode and new data without pretending available records. Keep navigation reachable.
- `CandidateClaimPanel.tsx`: public statement/account/report UI changes are in scope; old report validation, rate-limit recovery, success duplication and action appearance are gaps.
- `CandidateAccountControls.tsx`: shared dialog/field changes need scoped options to avoid silently restyling excluded claim/manage flows.
- `apps/frontend/src/data/candidateClaims.ts`: public report transport must send expected_version; model contains statement version and admin reports contain snapshot body/version. Preserve no-store, credentials omit and abort behavior.
- `apps/frontend/src/components/candidates/types.ts` and `apps/frontend/src/data/candidates.ts`: carry confirmed portrait/legislator/service-source fields and raw ticket identity from real data. Never add fabricated fallbacks to satisfy fixtures.
- `apps/frontend/src/components/candidates/candidateFlow.ts`: existing generation cancellation,4-entry60-second private-memory response cache and old-results retention are useful. Add UI memory needed for open groups/back position without persistent address storage.
- `apps/frontend/src/components/home/HomeCandidateFinder.tsx`: requested copy update plus exact punctuation and truthful privacy; avoid unapproved broader homepage redesign.

## Build gates and evidence record

1. Coverage accepted by parent; keep every requirement accounted for as implementation proceeds. This review does not establish approval of unrelated product choices.
2. Resolve data-backed conditional behavior through actual held fields: joint ticket name, source seat count, current/former service, verified legislator ID, portrait provenance, saved check time. A fixture makes a layout testable, not a production fact.
3. Preserve current real production limitations. Current official election list may expose only general election; named local gaps must remain generic when records lack identifiers. Claim/manage are existing staff-reviewed flows, not the old prototype.
4. For every row, append: implementation location; tested role/start/action; actual result; desktop/tablet/phone screenshot or measurement; keyboard/touch/error evidence; live result or approved exception. Use the evidence coverage table below; do not interpret the starting-code column as current behavior.
5. Minimum realistic journeys: homepage→search→suggestion→results→profile→legislator→back; direct empty→ambiguous→choice; editing address failure with old results; election rapid changes/failure/retry; closed group jump/find/print; direct profile→Find my candidates; account role entrances; campaign/report all feedback outcomes.
6. Browser tests must inspect every whole authorized screen including reused header/footer and every hover state. Test long text, large text, phone keyboard, focus return, slow and instant responses. Check parent coordinates independent final review from drawings and live release evidence.
7. Safe tests use controlled service responses for report submissions and source-dependent states. Actual production read-only navigation/data/portrait links can be inspected without writes. Do not send emails or create production claims/reports solely to prove appearance.
8. Carry exact settled copy/source corrections and user-approved arrow precedence into saved implementation/design-update notes. A returned drawing is not a dependency for objective settled corrections.

## Reconciled implementation decisions

- Homepage resolved: retain “Who’s running where you live?”; exact new support is “Explore the candidates in your Minnesota races, with links to official records”.
- Arrow reconciliation is settled by parent: higher candidate-inline position is approved; shared19px forward geometry/stroke1.8 and18px back chevron/9px gap remain. No sitewide replacement.
- Report wait resolved: route provides actual Retry-After and client parser exposes it; public UI must consume it.
- Report version race resolved: expected_version required;409 copy and reason-preserving reload behavior specified in P30.
- Production portraits and service claims: work is incomplete if real confirmed available legislator portraits are left as fixtures only; no portrait is appropriate when no credible confirmed asset exists.

## Sequential delivery plan and checkpoint

1. ACCEPTED: pin bundle checksum, define public search/profile/homepage-copy scope, independently compare this inventory and reconcile exact copy/arrow/source decisions.
2. COMPLETE: source adapters, confirmed portraits/service, public search/profile, homepage copy, account controls and report-version behavior are integrated.
3. COMPLETE: focused tests and exact settled Design notes are integrated. Source-dependent states remain conditional; claim/manage redraw stays excluded.
4. COMPLETE: 3,650 backend tests and 4,012 frontend tests pass, with typecheck, formatting, document checks and production export. Chrome covers all 3 layout bands and safe controlled mutation/error responses.
5. COMPLETE: independent review started from all 8 handoff files and exercised complete public flows. All observed blocking findings are corrected and rechecked, including native print clipping.
6. COMPLETE: the main release passed current-head and merge-queue checks, merged and deployed through [pull request 2463](https://github.com/alethical-org/alethical/pull/2463). The focused court-label correction passed its checks and merged through [pull request 2466](https://github.com/alethical-org/alethical/pull/2466).
7. COMPLETE: real deployed search/profile paths, links, portraits and source disclosures passed the live checks recorded below; this record closes release acceptance.

Completion checkpoint: the approved public design release is live, including the court-label correction. This document retains the complete scope, checks and explicit evidence limits.


## Integrated acceptance evidence

The approved public surfaces are implemented in the named candidate components,
with candidate-specific header/footer options and an opt-in shared arrow placement.
Independent browser review began with all 8 handoff files, not the implementation
diff. Chrome exercised the running checkout at the original local address.

| Coverage | Evidence and outcome |
|---|---|
| G01–G02, S04, S13, P01–P04, P11 | Chrome at 390, 900 and 1280: no horizontal overflow; one-column tablet/phone and two-column desktop results; whole portrait 84×104.5 phone and 120×150 desktop for a 240×300 source; long names wrap. Background, font sizes, card colors and spacing follow the approved drawings. |
| G03–G07 | Candidate home target 44px; phone menu 44px; candidate footer links minimum 44px at every band; profile action 48px. Keyboard election selection, disclosure jumps, menu Escape and report focus return exercised. Candidate arrows use the live corrected drawing's shared path, 19px box, 6px gap and -0.26em alignment. Header includes green Sign in on phone/tablet. |
| G08, S01–S03, S07, S10, P12–P14 | Exact copy in component and homepage snapshot tests. Real-source-shaped labels remove only proven duplicate election dates/districts; unknown labels survive. Actual government lookup attribution replaces the illustrative Census wording. Minnesota day-boundary tests preserve Candidate for timing. |
| S05–S12 | Entry button 350×60 on phone; compact edit field 56px outer and button 52px. Browser explicit address choice via ArrowDown/Enter, failed draft retained, suggestion Escape focus, no address query string. Flow tests cover cancellation, private cache clearing and late responses. Physical phone keyboard/touch is not established by desktop viewport simulation. |
| S14–S18 | Slow election switch retains coherent old rows/source/date/links. Failure retains old results and retry. After correction, Coverage documentTop remains 532→532 at 1280 and 504→504 at 390 while the same disabled retry control remains. Failed changed address retains confirmed address and previous races. |
| S19–S36 | Five general groups, primary fixture's actual 3 groups, Other local, default-closed Judges with 4 court-ordered races, counts/seat rules, single shared ticket link, exact-source grouping, collapse/jump/reopen and new-address reset exercised. Direct entry and first-load failure remain distinct. Conditional primary/seat states are fixture evidence, not a promise that the current live source supplies them. |
| P05–P10, P16 | Current/different office, reelection, former, service unknown, no connection, portrait loaded/failed and named ticket member exercised. Real data adapter returns 7 reviewed identity connections with official portraits; registration checks exact record and government member evidence. No name-only matching or invented former service. Old filing rows and duplicated public-record card are removed. |
| P15 | Profile integration tests exercise loading, service failure/retry, unknown ID and old request cancellation. Direct-entry browser action returns to empty search. Live direct profile and unknown-ID checks are part of deployment acceptance. |
| P17–P22 | Browser public/approved/pending/loading/error fixture controls show the correct claim/manage destinations and distinct failures. Published content remains separate from official records. Campaign failure shows a retry notice while the official record stays visible; absent campaign content omits the section cleanly. Account boundary and private content protections retain existing backend tests. No real claim or report is submitted for testing. |
| P23–P30 | Browser blank and 2001-character validation retain text; generic failure retains reason; Escape/Close returns trigger focus; changed version displays reload notice and then latest text; removed statement prevents submission. Actual wait fixture expires and submission returns without reload. Slow phone submit is 346×48 at x22/y768 both before/during request, with duplicate submission disabled. Backend rejects mismatched/missing statement versions. |

The independent reviewer found and rechecked corrections for phone Sign in,
44px home target, steady election retry and every fixture candidate profile link.
Independent code review additionally found the real-source duplicate labels and
non-phone footer target gap; both are corrected with scoped presentation behavior.
The current review does not claim physical-device keyboard testing. Native Chrome
find opened State and nested Judges from the fully collapsed screen when searching
for Judge Example3. Native print includes all groups, all 4 judges and the footer across 4 pages.
Cancelling print restores all 5 collapsed groups and normal scrolling; temporary
print classes are removed. No real printer job was submitted.

## Design record synchronization

The authorized Design correction conversation updated Candidates search.dc.html,
Candidates profile.dc.html, build-facts-candidates.md and copy-proposals-candidates.md.
The returned live drawing uses the same shared 19px arrow geometry with
`vertical-align: -0.26em`, a 6px gap, and the 18px return chevron with 9px gap.
It also carries truthful Minnesota service attribution, conditional confirmed
portraits/connections, and the changed-statement state with **Reload statement**.
No replacement download is required by this settled-correction round. The saved
export folder remains the pinned original input; these explicit corrections take
precedence for implementation.


## Live acceptance, October 1, 2026

The main release reached both the website and API as
[commit ed2f6785](https://github.com/alethical-org/alethical/commit/ed2f67851253b03af6e0abb133648631bab43637),
through [pull request 2463](https://github.com/alethical-org/alethical/pull/2463).
Independent Chrome review exercised real public records on www.alethical.com,
including 390px and 900px layouts; the implementation owner separately inspected
the confirmed portrait and legislator destinations.

- Homepage prints “Who’s running where you live?” and “Explore the candidates in your Minnesota races, with links to official records”. A public University of Minnesota test address reaches real results with the address excluded from the URL.
- At that address, the general-election response supplies State (36 races), County (3) and School board (2), with “Some local offices may be missing” separately in Coverage. Absent groups are not invented. Judges starts closed with 28 races in court order.
- A State jump opens the closed State group and focuses its heading. Independent County state remains intact. Opening Mohamud Noor’s profile and returning restores the address, election and group choices.
- The tablet election menu has a 2-line name/date and selected checkmark; Escape closes it and returns focus. Phone and tablet have no horizontal overflow, and candidate-footer links measure at least 44px.
- All 7 registered live profiles return the expected confirmed legislator connection, current-service evidence, official portrait and election record. All 7 portrait URLs respond successfully from the Minnesota Legislative Reference Library.
- Mohamud Noor’s portrait renders and “View legislator profile” opens his existing legislator profile. Cedrick Frazier’s current House office stays separate from his candidacy for Hennepin County Attorney. Lisa Demuth’s portrait appears in her named individual legislator panel, not as a portrait of the joint ticket with Ryan Wilson.
- An unknown candidate ID reaches the safe shared not-found screen; Home returns successfully. No illustrative-person marks or development state controls appear in the reviewed production flows.
- The sole live-review defect was raw Supreme Court labels for Associate Justice seats 1 and 4. The shared formatter now preserves “Associate Justice” and prints “Associate Justice, Supreme Court, Seat 1” or “Seat 4” in search and profiles. Independent review accepted both headings and Sarah Hennesy’s profile at the original preview; 2 new exact-source regression tests pass.

The current production source exposes only the general election in the reviewed
flow. Primary switching, slow responses, failures, report submission and account
states therefore retain the controlled local and automated evidence above. No real
production report, claim or sign-in was submitted, and physical phone keyboard or
touch behavior is not claimed. The original preview remains
http://localhost:19047/candidates in the task-owned checkout.

The security dependency update to pypdf 6.19.0 clears the release scan’s advisories.
All 3,650 backend tests pass with that version. Its PDF layout spacing required
normalizing spaces in the existing calendar-header test without broadening the
header window; all 101 calendar tests pass. The final court-label change passes
4,012 frontend tests across 323 files, plus type and formatting checks.

The court-label follow-up reached both the website and API as
[commit 2db25f2f](https://github.com/alethical-org/alethical/commit/2db25f2f11f392a16a86a68ac6eb9c5574a583f7),
through [pull request 2466](https://github.com/alethical-org/alethical/pull/2466).
The public release-stamp checks pass for both services. A fresh live reload of
Sarah Hennesy’s profile prints “Associate Justice, Supreme Court, Seat 1”. A new live
address search followed by opening Judges shows both corrected Supreme Court seat
1 and seat 4 headings.


## Isolated phone outline update, October 2, 2026

User authorization: “bd mobile isolated change”. Latest completed download:
`Alethical UX (52).zip`, downloaded October 2 at 08:13, SHA-256
`8e7c8f1639775dff5751f8a8b7b5f8576ac883d3f36906bf84c55d83282996d1`.
The isolated `review-prompt.md` and the updated entry drawing agree: below768px,
remove the outline beside the heading and center the same shipped decorative
asset below the address notes at160×176px, with40px above it. The heading receives
the whole content column. Tablet200×220 and computer300×330 remain unchanged;
results and candidate profiles are outside this update.

The downloaded drawing's embedded Bands note still described the old56px
beside-title outline. Its local review copy is corrected to the settled dimensions
and placement; the drawing itself requires no visual correction.

Delivery steps: implement the isolated entry change; run existing candidate tests,
type and format checks; inspect phone and both larger layouts at the original
http://localhost:19047/candidates preview; independent acceptance review; commit,
push, green current-head checks, merge and live phone acceptance.

Progress: implementation complete;20 existing candidate-content tests pass, type
and format checks pass, and the changed-component design detector reports no
findings. The390px working preview renders the map at160×176, centered atx115,
with exactly40px after the final address note and no horizontal overflow. The
image has empty alt text and aria-hidden=true. Independent acceptance covers
320px,390px,900px and1280px: no horizontal overflow, full phone heading width,
the exact phone map gap and dimensions, unchanged larger maps, and working empty
address feedback with focus returned to the field. Live release acceptance is
pending. Physical touch and the on-screen keyboard were not exercised.

Release prerequisite: the newly published node-forge signature advisory blocks
the required security check. The exact upstream nested-element validation repair
is applied through the existing pnpm patch mechanism. The security invocation
requires frozen installation, the exact repair fingerprints and installed
valid/malformed signature checks before accepting that specific raw finding.
The mobile change's scope and larger-screen appearance remain unchanged.


## Isolated address search busy buttons, October 2, 2026

User authorization: “bd for the candidate search button update see it?” Accepted
`Alethical UX (55).zip`, downloaded October2 at14:02:40, SHA-256
`ea9f1bb90e3fbbd0d7ab1f1d5e448eb0b269f665a37b21b817a519719a682c50`.
The isolated `review-prompt-busy-button.md`, `build-facts-busy-button.md` and
`Candidates search.dc.html` states2 and17 define the update. The actual drawing
was rendered at1280/900/390. The owning task accepted comparison coverage before
implementation. [Issue2478](https://github.com/alethical-org/alethical/issues/2478)
tracks implementation and release.

Comparison, in display order: preserve Full street address label and editable
field; preserve entry button248/220/full width×60 and compact button full width×52,
fill/border#2ed47e, ink#06231a and9px icon gap; change search icon to17px spinner,
trackrgba(6,35,26,0.25), arc#06231a and2.4px stroke,0.8s linear animation stopped
under reduced motion; print “Finding candidates…” exactly; retain focus with
aria-disabled, progress cursor and guarded pointer/keyboard activation; suppress
busy hover/press changes; keep22px error slot, margin12 entry/10 compact; retain1
hidden polite announcement; restore “Find my candidates” on result/error. Preserve
existing notes, retained results and election “Updating candidates…” status.
The tablet drawing permits wrapped waiting text inside the fixed button.

Objective bundle discrepancy: the idle entry drawing prints “Finding candidates…”
with its search icon. The explicit rest column and restore instruction require
“Find my candidates”; implementation preserves that settled ready label.

Impact and prevention: both affected submits share CandidateAddressForm and
CandidateButton. An optional busyLabel changes focus, cursor and spinner treatment
for these2 submits; sibling claim/report/retry buttons retain their own behavior.
The candidate homepage hands its request to /candidates and has no waiting submit
state. Error retry keeps its existing notice and suppresses the address form's
announcement so readers receive1 waiting message. Focused component and browser
checks cover the common path and intentional differences. Parent owns acceptance,
original preview19047 integration and live release; this worker owns code and checks
in an isolated checkout. No source, privacy, stored-address or data changes.

Completion evidence:68 focused candidate tests and TypeScript pass. Chromium and
WebKit browser checks at1280/900/390 cover entry/edit labels, dimensions, focus,
repeat pointer/Enter activation, reserved error space, slow success, no-match,
failed replacement/retry, reduced motion and unchanged election status. Production
export passes its297506-byte first-load limit at297084 bytes. Parent acceptance,
original preview integration and live release remain pending. Physical phone
keyboard, native autofill and screen-reader speech remain untested; DOM
checks establish the single polite live region without claiming spoken output.
