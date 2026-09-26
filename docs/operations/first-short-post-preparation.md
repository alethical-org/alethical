# First Short post preparation

Net: Release the accepted “2 records do not always mean 2 donations” with editable article correction links.

## Authorization and holds

Eugene authorized publication of this article on 26 September 2026 at 20:28:06 UTC in the task (social posts seo, `01a0d4e8-7a6a-7941-8124-12207773d4e2`): “publish the first post we accepted on the live site”. The same instruction called it accepted; that records his review and article-specific release instruction. The parent's completed editorial acceptance record was saved at 17:19:42 UTC after source checks and browser review. These are actual recorded event times, not placeholders.

This lifts the publication hold for “2 records do not always mean 2 donations” only. This release does not include the organizations or donor-totals drafts; the parent owns any separate publication instruction for those articles. Original evidence stays retained. Do not send real email.

The parent task “social posts seo” (`01a0d4e8-7a6a-7941-8124-12207773d4e2`) owns decisions and acceptance. Its source checkout and private preview at `http://127.0.0.1:8766/` remain untouched. Comments remain owned by “blog comments” (`01a0d4e4-f4d1-7b03-95d7-853fcaa37b48`).

## Work and checks

1. Integrate the parent's approved shared presentation and wording changes from the task (social posts seo), excluding the already-landed release record and unrelated comments note. Done.
2. Independently recompute retained source rows and inspect both cited filings. Done: 2 identical $500 rows; each filing contains 1 matching $500 entry. All retained manifest hashes match.
3. Complete private article record, blank human approval and publication fields, matching initial HTML, full-content fingerprints and separate download copy date. Done.
4. Editable correction-contact prefilling from registered article identity, preserving reader text across in-app navigation and retries. Done; browser delivery mocked.
5. Frontend tests, build, contact-server tests, phone/tablet/desktop browser review and independent implementation review. Done; results below.
6. Preparation and parent acceptance complete at [commit 8e084b02](https://github.com/alethical-org/alethical/commit/8e084b02c8becd0b47412157b85048cc6262efe2). Eugene subsequently authorized this article’s release.

## Evidence handling

Working evidence is private, outside git. Retained originals remain unchanged. The private source ledger contains older drafting instructions; the approved latest note replaces those instructions. The later filing is named “later filing,” following its cover and the accepted copy. The CSV's overall reporting-period end is unknown. Only the cited filings establish the article's December 20, 2023 records-through date.

The retained-copy policy in [published-writing-decisions.md §2.14](../architecture/published-writing-decisions.md#214-we-keep-our-own-copy-of-every-source-a-published-piece-cites) keeps archives internal. The source ledger's extra public-copy requirement is not adopted. Public readers receive the 3 approved official links and exact reproduction method.


## Acceptance evidence

- 289 frontend suites, 3,668 tests pass. Type checks pass.
- Frontend production build and first-load size check pass. The locally built entry uses 295,139 of the 296,022 compressed-byte allowance; the hosted build must repeat its own check with deployment settings.
- 19 contact-server tests pass against a temporary database with email delivery mocked.
- Private article test passes: 4 supported claims, matching text and links in initial HTML, and all publication holds enforced.
- Real Chromium browser at widths 375, 820 and 1280: no horizontal overflow, 2:1 chart bars, unwrapped amounts in Libre Franklin, keyboard-operated full method, disabled sharing and no page errors.
- Real contact form: expected article title and permanent address, identity fields blank, edited text preserved through navigation, failed send and identical retry, successful send then blank new message. Every send intercepted locally; no email sent.
- Unknown article identities and arbitrary subject or URL inputs leave a fresh contact form blank. The private first article remains unknown to the public registry until its authorized publication.
- Independent implementation review accepted the correction-link navigation and complete visible-content approval checks after their regression tests passed.

## Authorized release sequence

The task (Prepare first short post for publication, `01a0de8f-369c-7f30-a8c5-c59768f40b31`) owns the authorized release through the live result:

1. Move the final private article record into the public article data module and replace private absolute imports with repository imports.
2. Record genuine editorial approval, Eugene's review of the final contents and the article-specific publication instruction. Set the real publication date and full timestamp at release; compute approval against the final record rather than a fixture.
3. Register the article for public navigation and search, retaining the 3 official links and internal source archive. Require the publication checks to return no errors.
4. Repeat the production build, initial-HTML/metadata/sitemap checks and phone/desktop checks. Open the article's correction link through the real app without sending email.
5. Merge only after required checks pass, then open the public article address and exercise the changed flow. Record the live result and any dated correction honestly.

The release timestamp is 26 September 2026 at 20:32:16 UTC, when the accepted article entered the publication build. Its Minnesota publication day is September 26. The frozen approval fingerprint is `758077a2`; publication fields are the only changes from the accepted private record. Release checks and live acceptance are recorded as they complete.

## Release acceptance before upload

- 294 frontend suites and 3,712 tests pass; TypeScript passes.
- Production build passes at 295,863 of the unchanged 296,022 compressed-byte first-load allowance. Hosted deployment repeats this check with production settings.
- Phone, tablet and desktop browser checks at 375, 820 and 1280 pixels pass: no sideways overflow, 2:1 bars, amounts on 1 line, keyboard method disclosure, all 3 official source links, and archive/topic discovery.
- The actual correction link fills the accepted title and permanent article address, leaves identity fields blank, and preserves an edited message after returning to the article. No message was sent.
- Independent acceptance found the public record identical to the accepted private contents after excluding publication and approval fields. Publication validation returns no errors; approval is frozen against fingerprint `758077a2`.
- The comments service recognizes the article's stable identity. No comment was submitted.
- Upload checks pass against the exact committed tree, including 3,443 backend tests with temporary local data and mocked external effects.
- Current-head GitHub checks and merge-queue checks pass. [Pull request 2400](https://github.com/alethical-org/alethical/pull/2400) merged at 21:12 UTC on 26 September 2026.
- The hosted production build measured 296,142 startup bytes, 120 above the previous limit, and stopped before deploying. The focused recovery uses that hosted measurement plus the existing 739-byte margin; local and preview results do not set the limit. Deployment and live acceptance remain pending.
