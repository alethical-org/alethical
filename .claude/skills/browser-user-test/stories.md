# Scripted user stories

The catalog the `browser-user-test` skill drives. Each story is written for a tester
who knows nothing about the implementation. `Spec:` names the Playwright file a story
has graduated into (`apps/frontend/e2e/`), or `not yet`.

Format rules: steps are what a user does, never what the code does; "Passes when" is
observable on screen; stories are read-only unless the story says otherwise, and
write-actions (sign-in, track) are never performed against production.

## 1. Read a hot bill from the front page

- Persona: heard about the new social-media law for kids; wants to know if it's real.
- Steps: open the home page → find a bill in the news → open it → read what it does.
- Passes when: the home page shows current bills with plain-language summaries; the
  bill page opens from a click; the summary is understandable without legal knowledge;
  a link back to the official record is visible.
- Spec: `home.spec.ts` covers the home-page half; the bill-page half is `not yet`.

## 2. Search bills by a topic word

- Persona: a parent who wants to know what the legislature did about schools.
- Steps: open Search bills → type "school" → skim results → open the first result.
- Passes when: results appear as you type; a result count with an as-of date shows;
  every card leads with a plain sentence, not a statute citation; the opened bill page
  matches the card that was clicked.
- Spec: `search-bills.spec.ts` covers search-to-results; the open-a-result half is `not yet`.

## 3. Find a legislator and read their profile

- Persona: wants to know who represents them and what that person has done.
- Steps: open Search legislators → browse or search a name → open a profile → look for
  their bills and votes.
- Passes when: the list shows name, party, chamber, and district; a profile opens and
  shows the same identity plus authored bills; nothing claims an opinion or position,
  only records.
- Spec: `legislators.spec.ts` covers list-and-fields; the profile half is `not yet`.

## 4. Ask a question in your own words (signed out)

- Persona: skeptical first-timer; asks "what's in the new social media law for kids?"
- Steps: use the ask box on the home page → submit → read the answer page.
- Passes when: the answer cites official sources (links resolve), or the page honestly
  says it can't answer — a refusal is a pass when no stretch was available; nothing
  advertises a follow-up the page cannot do.
- Spec: not yet (answer content needs judgment, stays agent-driven).

## 5. Arrive in the middle from a shared link

- Persona: got a bill link in a group chat; has never seen the site.
- Steps: open a bill page URL directly (no home-page visit) → orient → follow one link
  (e.g. an author) → use the browser Back button.
- Passes when: the page stands alone (product name, what this page is, path to more);
  Back returns to the bill with its state intact; nothing assumes a visit started at home.
- Spec: not yet.

## 6. Hit a genuine miss and read what the site says

- Persona: searches for something the corpus genuinely has nothing on (a gibberish
  word, or an out-of-state topic like "California earthquake retrofit").
- Steps: search bills and legislators for a no-match term → try asking the same thing
  in the ask box → read every empty state reached.
- Passes when: each miss says honestly that nothing matched — no made-up results, no
  blank or broken screen, no confident answer stretched from unrelated data; the page
  offers a sensible next step. (Origin: the first live test run, Aug 14 2026, never hit
  a miss, so this path had been verified by nobody.)
- Spec: not yet.

## 7. Find your legislator by address

- Persona: doesn't know their district; wants their own representatives.
- Steps: open Search legislators → use "Find your legislator by address" → enter a
  public Minnesota address (e.g. the State Capitol, 75 Rev Dr Martin Luther King Jr
  Blvd, St Paul) → read the result.
- Passes when: the flow completes without sign-in; the result names legislators and
  districts; a wrong or out-of-state address fails with a helpful message, not a crash.
- Spec: not yet.
