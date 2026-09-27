# Read consistency build checkpoint

The first approved listing changes are committed on `codex/read-consistency` at
`b25a4a41`: `/read` and `/read/short-posts` share the approved metadata and row
treatments. The remaining article drawing is in `Alethical UX (29).zip`, section
1c of `build-facts-read-consistency.md`. The comments drawing is in
`Alethical UX (30).zip`, whose only new product change from the shipped comments
bundle is that the discussion rules card scrolls with the page.

The article build changes publication metadata to uppercase Franklin with a
comma in the date and no scope colons, styles the kind word above the title
like the report label, and gives both method and source headings the same
monospace treatment. The article's existing facts, chart values, source links,
and disclosures remain intact. Related reading draws after comments when a
published piece has editor picks. The proposed picks for each of the 3
published Short posts are the other 2 published Short posts and the guide
`what-the-records-name`; they remain outside the article record until Eugene
reviews the exact links:

| Article slug | Proposed related slugs, in order |
| --- | --- |
| `lobbyist-giving` | `organizations-both-parties`, `2-records-not-always-2-donations`, `what-the-records-name` |
| `organizations-both-parties` | `lobbyist-giving`, `2-records-not-always-2-donations`, `what-the-records-name` |
| `2-records-not-always-2-donations` | `lobbyist-giving`, `organizations-both-parties`, `what-the-records-name` |

The article
presentation marks the final total row explicitly, removes only that row's
lower line, and uses the existing 26px paragraph gap below tables. The
published organizations piece also displays its final `Combined` row as a total.
The discussion rules card no longer sticks to the screen while scrolling.

## Release gate and next checks

Changing related-reading picks changes the saved article fingerprint. The
publication check rejects this until the required post-publication review
record is settled. The current build leaves those picks empty and preserves
the existing publication checks. After the link decision, apply the prepared
picks with the approved review record, rerun focused tests and web export,
inspect the existing preview at `http://localhost:8782/read` on phone and
desktop, then deliver through the repository's normal release steps.
