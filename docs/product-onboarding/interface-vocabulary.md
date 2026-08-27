<!-- describes: apps/frontend/src/theme/primitives.tsx, apps/frontend/src/navigation/ia.ts -->

# Interface vocabulary — one word per thing

**Net:** One name per thing, everywhere: in chat, in a brief to a session, in a prompt to Design, in
code identifiers, and in reader-facing copy. This file is the list. It exists because the same thing
was called 3 things in an hour and nobody could tell whether 2 people were discussing the same
object.

Started 27 Aug 2026, after Eugene pointed out that a session was saying "top bar" while he was
saying "nav".

## How a word gets settled

1. **Eugene's word wins** where he has one. He is the reader's proxy and he says the word out loud
   more often than anyone.
2. **Where neither of us has one, the plain guessable word wins**, per
   [`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 7: literal, in plain words, no
   metaphors, no coined terms, no shorthand that only makes sense to whoever was in the conversation.
   Industry jargon fails that test even when it is precise.
3. **The reader-facing word and the code's own name are the same word.** Eugene's standing rule, and
   the reason the earlier rename turned "report" into "research" in the code rather than only on
   screen.
4. **A word here binds Design too.** When a bundle introduces a different one, prompt it back into
   sync and say which rule the new word breaks, while genuinely inviting its case that our rule is
   wrong.

## The list

| The thing | Our word | Never |
| --- | --- | --- |
| Any page | **its address**, `/read`, `/money` | the listing page, the reading page, the shelf, the index |
| The site's own navigation, either band | **nav** | top bar, the bar, top menu, menu, header |
| A nav item that opens something rather than going somewhere | **trigger** | dropdown, flyout control |
| What a trigger opens on the computer band | **panel** | dropdown, flyout, submenu |
| The nav on the phone band | **drawer** | sheet, hamburger, tray |
| One line inside a panel or drawer | **row** | item, entry, link |
| A published piece of our own writing that concludes | **research** | report, article, story |
| A published piece that teaches one term | **guide** | explainer, basics, primer |
| A group of pieces meant to be read together | **set** | series, collection, course |
| The fold-open group of a set's pieces on `/read` | **set box** | accordion, disclosure, expander |
| A piece's own listing item on `/read` | **card** | tile, entry, teaser |
| The block of title and dates at the top of a piece | **masthead** | header, hero |
| The line under a piece's title | **subtitle** | dek, standfirst, deck, blurb |
| The small line above a title naming what a piece is | **kind label** | eyebrow, kicker, tag, chip |
| The grey line under the heading on `/read` | **intro note** | dek, standfirst, subhead, blurb |
| Minnesota's own filed disclosure document | **report** | filing, return, disclosure |

## The 2 rows that are corrections rather than confirmations

Everything else above records a word already used consistently. These 2 do not:

- **subtitle.** `ResearchPiece` in `apps/frontend/src/lib/research.ts` names the field `dek` and its
  own comment 2 lines above calls the same thing a "standfirst". One object, 2 newsroom words,
  adjacent lines. Neither is guessable by a newcomer, so both lose to **subtitle**.
- **kind label.** The code says `eyebrow`, which describes where the line sits rather than what it
  is, and the line now prints the piece's kind. **kind label** says what it is.

Renaming either is a mechanical change nobody has scheduled. Until it happens, this file is the
authority on the word and the code is the authority on the identifier, and a new surface uses the
word here.

## What this file is not

It is not a design system and it does not describe appearance, spacing or colour. Those live in the
design handoffs and in `apps/frontend/src/theme/tokens.ts`. This is only the list of names, so that 2
people describing the same object use the same one.
