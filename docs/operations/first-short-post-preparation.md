# First Short post preparation

Net: Prepare “2 records do not always mean 2 donations” and article correction links while publication is held.

## Authorization and holds

Eugene approved private-draft refinements, the shared closing note, and correction-contact prefilling, then approved a separate preparation task. Final publication still requires his separate instruction. Do not add this article to public registries, assign its publication timestamp, merge a change making it public, send email, or mark publication complete during preparation.

The parent task “social posts seo” (`01a0d4e8-7a6a-7941-8124-12207773d4e2`) owns decisions and acceptance. Its source checkout and private preview at `http://127.0.0.1:8766/` remain untouched. Comments remain owned by “blog comments” (`01a0d4e4-f4d1-7b03-95d7-853fcaa37b48`).

## Work and checks

1. Integrate the parent's approved shared presentation and wording changes from the task (social posts seo), excluding the already-landed release record and unrelated comments note. Done.
2. Independently recompute retained source rows and inspect both cited filings. Done: 2 identical $500 rows; each filing contains 1 matching $500 entry. All retained manifest hashes match.
3. Complete private article record, blank human approval and publication fields, matching initial HTML, full-content fingerprints and separate download copy date. Done.
4. Editable correction-contact prefilling from registered article identity, preserving reader text across in-app navigation and retries. Done; browser delivery mocked.
5. Frontend tests, build, contact-server tests, phone/tablet/desktop browser review and independent implementation review. Done; results below.
6. Open a draft pull request and report artifacts, checks and remaining release steps to the parent. Do not merge or publish during preparation.

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

## Release steps still held

The task (social posts seo, `01a0d4e8-7a6a-7941-8124-12207773d4e2`) owns acceptance and the publication decision. After Eugene reviews this exact private article and separately instructs publication, the release owner must:

1. Move the final private article record into the public article data module and replace private absolute imports with repository imports.
2. Record genuine editorial approval, Eugene's review of the final contents and the article-specific publication instruction. Set the real publication date and full timestamp at release; compute approval against the final record rather than a fixture.
3. Register the article for public navigation and search, retaining the 3 official links and internal source archive. Require the publication checks to return no errors.
4. Repeat the production build, initial-HTML/metadata/sitemap checks and phone/desktop checks. Open the article's correction link through the real app without sending email.
5. Merge only after required checks pass, then open the public article address and exercise the changed flow. Record the live result and any dated correction honestly.

No step in this section is authorized by completion of preparation alone.
