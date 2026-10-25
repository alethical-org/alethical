# Reviewing Alethical's rendered web interface

Use the shared [design-audit skill](https://github.com/euglopi/tool-settings/blob/main/shared/skills/design-audit/SKILL.md)
and its pinned, licensed guidelines through the following project adaptation. Current
[design principles](design-principles.md), [UI copy](ui-copy-guide.md) and
[grounded-answer rules](../../.claude/rules/grounded-answers.md) control product choices.

Alethical's frontend is **React Native + Expo, shipped to web via `react-native-web`**. Source is
`.tsx` using RN primitives (`<View>`, `<Text>`, `<Pressable>`, `<Image>`), **not** DOM/CSS/Tailwind.
The snapshot is written for the DOM. Apply it like this:

- **Do NOT lint RN source files literally.** Rules naming raw HTML tags (`<button>`, `<img alt>`),
  ARIA attributes, CSS properties (`focus-visible:ring-*`, `transition: all`, `overscroll-behavior`),
  Tailwind classes, Next.js/hydration/`<meta>` specifics, and `env(safe-area-inset-*)` do **not** map
  to RN `.tsx` and will fire false positives. RN has its own equivalents (`accessibilityLabel`,
  `accessibilityRole`, `accessibilityState`, `hitSlop`, `SafeAreaView`, the `focus` shadow token).
- **Audit the RENDERED web output, not the source.** Run the app (`just up` → `http://localhost:19006`)
  or open the Vercel preview. `react-native-web` emits real DOM there and maps RN a11y props to ARIA,
  so the DOM-level rules become checkable. **Fix findings by editing the RN props/tokens**, never by
  hand-editing DOM.
- **The platform-agnostic subset always applies, source or rendered.** This is the high-value core and
  it *is* `design-principles.md` §3: visible focus, WCAG-AA contrast, ~44px touch targets, no
  affordance living only in hover, URL reflects state (also `grounded-answers.md` rule 5), destructive
  actions confirm, honor reduced-motion, designed loading/empty/error states, `tabular-nums` for number
  columns, `…`/curly quotes, active-voice specific button labels.
- **Copy findings defer to the copy owners.** Any wording finding must respect
  `.claude/rules/grounded-answers.md` (author/co-author not sponsor; "issue" not "topic"; "Grounded
  Ask" / "✦ Ask", never "Ask AI") and is *owned* by `docs/design/ui-copy-guide.md` — flag it, don't rewrite
  copy here. **Punctuation conventions live in that guide's "Punctuation & typography" section:**
  curly apostrophes `’` and quotes `“ ”` in user-facing copy (straight ASCII only in code), and
  input placeholders do **NOT** trail with `…` — this deliberately **overrides** the snapshot's
  "Placeholders end with `…`" rule, so do not flag a placeholder for lacking one.
- **Don't double-name a field: `accessibilityLabel` + a differing `placeholder` makes VoiceOver
  announce BOTH** (heard live on the signed-out home ask field, 2026-07-13: it read the placeholder,
  then the label, then the role — noisy, duplicative). A `<TextInput>` whose visible placeholder
  already *describes* the field (not just a format hint) should carry **no** `accessibilityLabel` — the
  placeholder is its accessible name (RN-Web maps `placeholder` to the accname fallback), so it's read
  once. Only add `accessibilityLabel` when there's no descriptive visible text (icon-only buttons) or
  when the label and placeholder would be *identical*. When flagging: "input has both a label and an
  overlapping placeholder → drop the label, or make them identical." Persistent-name tradeoff: a
  placeholder-only name isn't announced once the field has a value — acceptable for search/ask fields;
  if a field genuinely needs a name that survives typing, set `accessibilityLabel` **equal to** the
  placeholder rather than a second, different string.

## Scope

Review shipped UI; do not generate or restyle designs. When available, the existing
`design:accessibility-review` is the project's default accessibility review for each screen.
Use the broader shared audit for rendered-web interaction and polish, including reduced motion,
typography, equal-width digits and URL state. If that tool is unavailable, perform the same
required checks through available browser tools and state coverage; never claim an unavailable
review ran. Static inspection does not prove live keyboard or screen-reader behavior.
