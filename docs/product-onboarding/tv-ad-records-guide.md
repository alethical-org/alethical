# TV ad records guide

<!-- describes: alethical/api/routers/tv_ads.py, alethical/api/services/tv_ads.py, alethical/api/services/tv_ad_review.py, alethical/pipeline/tv_ad_redaction.py, apps/frontend/src/components/tvAds/**, apps/frontend/src/components/tvAdReview/**, apps/frontend/src/screens/redesign/TVAdRecordsScreen.tsx, apps/frontend/src/screens/redesign/AdminPoliticalAdsScreen.tsx -->

TV ad records collect station files from KSTP-TV, KARE and KMSP-TV. They help readers distinguish what was ordered, billed, credited or reported in campaign records. A title alone does not prove an ad aired or a bill was paid. The first reader release is for signed-in administrators. Public access is not approved.

## Where to begin

Administrators can enter from the TV ad records card at `/money`, from its separate group at `/money/search`, or directly at `/money/ads`. A short reading guide lives at `/money/ads/guide`. The guide is not in public article search, sharing controls or the sitemap. Signed-out and ordinary signed-in readers see the existing not-found result for direct TV addresses. Their money pages keep the existing six cards and no TV groups or gaps.

Related records may also appear beside a committee, a legislator's confirmed campaign committee, a candidate, an outside spender, a particular race, or a lobbying principal. Each connection belongs to the exact checked file. A candidate merely named on a document appears separately from a checked advertiser or payer. Race connections retain their stage. Search under a printed agency spelling is a name search, not proof that the records describe the same organization.

## Search and browse at `/money/ads`

Administrator search matches held file labels, checked facts and machine-read text, including originals awaiting publication review. Text matches remain labelled Not checked. Browse by station folders, agency names, stations or years. Machine-read agency names are marked Not checked; each exact spelling stays separate. Folder filters cover station, folder year and the literal station category. The newest available folder year is selected first. Results have 12 rows per page; search is capped at 500 and says when more exist.

A station category describes the station's filing choice. It does not identify an election office or establish a connection. Unknown categories stay unknown. Spelling variations remain separate. A checked empty folder can appear with zero files.

Changing a filter or page keeps the previous results visible with an updating notice until the replacement arrives. A failed request keeps usable results and offers retry. A new search starts at page 1. An empty result explains that there are no matching collected records; it does not mean no ads existed. Counts and source dates load separately, so a failure in one does not hide the other.

Folder and printed-name screens retain the authorized heading, metadata and results during retries and temporary failures. While replacement results load, retained rows use the existing 85% opacity treatment with an updating status. Before a name has loaded, their headings are “Station folder” and “Printed agency name”. Changing the record or account clears prior content; missing or withdrawn records never retain old details. A folder with no held files says “No files to show in this folder”.

## What counts mean

- Station files held counts station plus FCC file ID once when original contents have been saved.
- Unique file contents counts different saved byte sequences, including older versions. Identical contents count once across files.
- Files with an approved copy counts a file once when any saved version still has an approved viewable copy.
- Files whose text could not be fully read uses the current text reader and latest successfully downloaded contents.
- Files we couldn't download from the FCC uses each file's latest conclusive download attempt, including never-saved files.

These counts overlap. They are not ad counts, spending totals or proof of complete history. Folder-list failures count folders separately. Missing values never become zero. Sources name the newest known upload, last successful listing check and last successful file copy separately for each station.

## Read a saved file

At `/money/ads/files/<key>`, the station, filename, folder year and station category identify the file. Administrators can open original page images and machine-read text without publication approval. An available approved copy remains separately identified. Checked facts, dates and connections retain their own evidence and status. Open a fact's page link to see its quoted evidence. Page controls and phone zoom help inspect an image. Machine-read text begins closed below computer width and remains labelled Not checked.

Opening an original does not approve it. Originals say “Original station file · Not checked or approved for publication”. Exact links to metadata-only publication copies retain their not-ready state. A failed image can be retried. An unreadable text page does not imply an unavailable image. Personal contact details are removed before approved publication images and text are generated; a browser overlay is not the redaction.

Saved versions are ordered by first saved time in Central time. The current source follows the latest successful download, so a source changing A to B and then back to A makes A current. Checks never transfer to replacement contents. Links to evidence preserve both source version and exact approved copy. Older approved records stay identified when the current source changes. An exact withdrawn publication-copy link shows its withdrawal state instead of falling through to another copy. Administrators may separately inspect the held original without restoring its approval.

Dollar figures omit cents without rounding; quotations preserve source precision. Gross, net, commission, credits, ordered amounts and reported expenses are separate. Multiple airing periods stay separate. The screens never add documents or versions into spending totals.

## Follow connections and history

Each checked connection has its own quote, page and check date. A folder relationship says only that the folder relates to a committee; files require separate checks. Related documents open the exact checked copy. Expense evidence opens the exact saved campaign-finance row. A changed current filing is labelled without replacing the older evidence.

Agency addresses need a separately checked agency association and preserve the printed role. Equal names alone do not qualify. Facts may have correction history when each older value remains safe to publish. Withdrawing unsafe information removes the value and quote, including previously approved history.

## Review at `/admin/political-ads`

Administrators reach `/admin/political-ads` through “Review TV ad records” in the existing administrator menu on phone, tablet and desktop.

The private review queue lists source files and retained folders. Select a source version, inspect original pages privately, prepare safe metadata and page text, and mark redaction rectangles. A prepared preview shows the pixels readers would receive. Inspect every page before approving the exact prepared fingerprint and the privacy, metadata and text attestations. Preparation does not approve publication.

Facts require a supported field, value, source page and exact quote. Connections require an inspected target and exact evidence. Correctness and publication permission are separate decisions. Candidate connections require the election stage and named/advertiser/payer role. A race needs its exact contest; adding a campaign-money office and district requires a separate association check. Review cannot promote a folder relationship to its files.

Source or target changes clear earlier review attestations. Saving and retry controls keep their positions and prevent repeat submissions. Failed operations report the failure and allow correction. Withdrawal takes effect on later reader and image requests; old links do not restore approval. Review actions remain in private audit history. Account or sign-in identity deletion removes the reviewer’s account identifier while retaining the source evidence and decisions, including older campaign-payment review history; [user-data-retention-policy.md §6](user-data-retention-policy.md#6-what-deletion-should-mean) owns that policy.

## Sources, privacy and limits

The source archive and operational limits are documented in [fcc-political-files.md](../implementation/fcc-political-files.md). FCC political files must be retained for at least 2 years; older available files are not complete history. There is no coverage of other stations, cable, radio, streaming or online advertising.

Reader requests send search and filter choices to Alethical. Private responses are not cached for shared reuse. Administrator permission is checked on every API request. Original documents and review notes remain private. Administrator TV search can match held originals; private review notes do not enter search. No feature here submits an ad request, contacts a campaign, changes a filed expense, or subscribes a reader to messages.

## Visual layout and review

The TV screens use the approved flat background, shared search and menu controls, and neutral document-kind labels. Search occupies at most 780 pixels on larger screens. Folder file rows and station year rows each have one whole-row link, including a visible keyboard outline. Phone folder rows show the document kind below the filename and retain separate airing, upload and version details.

Printed-agency station cards and checked-address cards use 2 columns at computer width and 1 below 1100 pixels. Station and year headings apply to their contained file rows; upload dates remain beside each file. A long filename may wrap without hiding its date or checking status. Address evidence links retain the exact file version, copy and source page.

Station summaries put held counts before source dates. The station-year table presents folders by the 6 standard category headings, followed by any additional source category names. A missing category value says Unavailable, never an invented zero. Below 768 pixels, each year becomes one card with category labels beside their counts.

Visual acceptance compares rendered computer, tablet and phone screens with Claude Design's drawings and saved standards. It includes open menus, keyboard focus, pointer hover, disabled controls, loading, failures and empty records. Browser checks separately exercise whole-row links, menu selection, page images, text, saved versions and failure recovery; screenshots do not establish working behavior. Publication statuses and private administrator access remain separate.

File, agency and station loading or failure states keep their identifying heading. Empty agency and station lists use a white message surface. A metadata-only exact publication link can show that its copy is not ready; ordinary administrator archive links still open the original. Saved-version menus stay within the viewport, retain keyboard and touch selection, and show saved time, station upload date and status on separate lines.

Whole-row folder and station links show one keyboard outline around the row, without a second outline around the title. Hover fills the row; pointer clicks do not add a keyboard-only outline. Other-file cards stack title, kind and station upload date at every width.

Final review refinements: address evidence links keep a 44px target while their
keyboard outline follows the link width. Agency row outlines sit 2px inside an
8px corner radius. An agency with no checked addresses uses the same white empty
surface as its missing file list. Station and file failures name the affected
record and explain “This is a problem on our side” beside the retry action.
