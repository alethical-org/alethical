# Sitewide destination-card keyboard focus

Status: local acceptance complete; release in progress, 27 September 2026.

## Authorization and target

Eugene requested “bd eval where it applies sitewide if design's missed anywhere”.
The latest completed download is `Alethical UX (31).zip`, added at 08:31:21 Eastern
on 27 September. Its target is 1 keyboard-only purple outline around each whole
card or row opening a destination: 2px `#7c5cff`, 2px offset, matching corners.
Separate inner destinations/actions retain their own keyboard targets. Hover stays
unchanged. Existing contribution-disclosure arrow treatments remain intact.

Eugene then asked whether Sol could build with Astra managing. Sol owns code edits
in this checkout; Astra owns acceptance, integration and the live release.

## Ordered work

1. Audit destination cards/rows and identify already-correct components. An
   independent read-only helper covers non-money/non-editorial components while
   the implementation helper checks money and shared focus behavior.
2. Correct demonstrated duplicate, pointer-triggered, misplaced or clipped rings.
   Keep 1 code writer. Exercise keyboard navigation, pointer navigation and Back,
   distinct inner targets and corner geometry at 1280px, 900px and phone width.
3. Integrate the separately owned editorial release before editing editorial
   components or shared design notes. The active chat **social posts seo**
   (`01a0d4e8-7a6a-7941-8124-12207773d4e2`) owns that work in
   `/Users/eug/.codex/worktrees/7c04/Alethical` on `codex/read-consistency`.
   Its committed title-link fix suppresses the title outline with `!important`
   and draws the replacement on the card. Its preview at localhost:8782 stays
   under that chat's control. Do not overwrite its unfinished changes.
4. Astra reviews the complete patch, updates the shared design guidance, runs
   relevant checks and accepts real-browser evidence, including an independent
   reader pass. Report unavailable private surfaces precisely.
5. Commit, open and attach a pull request, address findings, wait for current-head
   checks and merge-queue checks, merge, observe deployment, and exercise the live
   result. Put durable evidence on the pull request, then remove this completed
   plan and its index entry.

## Evidence and current step

- Live `/read` on 27 September shows 2 purple outlines for the first short-post
  destination after keyboard Tab: the title anchor and its full-row pseudo-element
  both compute to `rgb(124, 92, 255) solid 2px`. The accepted drawing shows only the
  full-row outline. The sitewide `!important` rule defeats the old title override.
- Bill, legislator and tracked-committee cards already use single full-card links
  or correctly rounded overlays. Do not rewrite them without a browser finding.
- Citation cards retain a focus-driven glow alongside the global keyboard outline.
- Implementation is complete on `codex/sitewide-card-focus` from `8000914a`.
- Local acceptance: 5 browser cases, 52 focused screen checks, type check and
  formatting pass. An independent browser reader exercised public cards and rows
  at desktop, tablet and phone widths. Account scrolling uses an invented local
  account fixture, with no real sign-in. Astra inspected the rendered outlines.
- The editorial release is [pull request 2409](https://github.com/alethical-org/alethical/pull/2409).
  Its owner confirmed no edits to the shared keyboard-focus section, so this branch
  adds that scoped guidance without waiting for unrelated article layout changes.
- Publication is authorized for this scoped interface repair. No new data changes,
  authentication, real sends, paid services, recurring work or new Design requests.
