# Committee and profile money refinements: approved copy record

Approved 17 September 2026 for `/money/committees/<slug>` and
`/legislators/<name>?tab=money`. This records changes made during the build so a
future drawing uses the current words and controls. It is not a new design brief.
Print the approved words verbatim. Ask about missing text rather than inventing it.
Propose copy improvements separately, with their reasons; proposals are welcome.

## Copy changes

| Surface | Previous text | Approved text |
| --- | --- | --- |
| Committee payment destination | All received payments; All expenditure payments | View receipts and expenditures |
| Committee coverage, line 1 | Money filed with the Minnesota Campaign Finance and Public Disclosure Board | Campaign finance reports filed with the Minnesota Campaign Finance and Public Disclosure Board |
| Committee coverage, line 2 | Money figures start in 2015 | Campaign finance figures in our copy start in 2015 |
| Committee coverage, line 3 | Donors who gave $200 or less in total for the year need not be named | Committees need not name contributors who gave $200 or less in total during the calendar year |
| Ballot-question coverage, line 3 | Donors who gave $500 or less in total for the year need not be named | Committees need not name contributors who gave $500 or less in total during the calendar year |
| Board-record helper on committee, profile and payment views | The Board’s record for this committee lists every report it filed, under Reports and Data. | The Board’s record for this committee lists every report it filed, under Reports and Data |
| Standalone non-itemized explanation | Donations inside the committee’s reported total whose givers the state’s public file does not name. | Donations inside the committee’s reported total whose givers the state’s public file does not name |
| Generic political committee or fund ownership explanation | This record covers the political committee or fund named above. | Removed; omit its container when no useful content remains |
| Committee year choices | Current and prior years, with Earlier years revealing the rest | 1 Year label followed by every year from the current calendar year back through 2015, newest first |
| Generic committee/profile card footer | Minnesota’s campaign-finance downloads | Removed from this footer; retained inside the outside-spending card with its source filename |

The payment link retains the chosen year and opens the received-payments direction
(`tab=gave`). The destination still offers received and outgoing directions. Receipts
can include loans and other non-contribution money, so the label does not call every
receipt a contribution. Independent spending remains a separate source.

The coverage block prints exactly 3 lines, using only the threshold for that
committee’s kind. The threshold still concerns the contributor’s total for the
calendar year, not an individual payment. It is the floor for required naming;
committees may name smaller contributors. Candidate ownership explanations and
confirmation details remain. Party-unit, caucus and ballot-question explanations
remain where they explain a real distinction.

## Appearance and interaction

- The committee header is white. Money in, Money out and any additional financial
  summary card use the profile’s grey `c.tile` surface.
- The shared year group has 1 normal-weight Year label and normal-weight 400 Libre
  Franklin numerals with equal-width digits. Buttons have 10px rounded corners and
  at least a 44px target. The selected year is black with white text on both surfaces.
  The complete group wraps on smaller screens. The history chart’s separate
  **Show earlier years** control is unchanged.
- The contribution, confirmation-evidence and grouped outside-spender disclosures
  keep the whole row clickable and keyboard-accessible. The purple focus ring sits
  around the arrow’s rounded 44px area, with the arrow centred inside. The arrow
  adds no separate keyboard stop. A whole-row focus ring elsewhere needs at least
  12px of horizontal interior space; this build does not restyle unrelated controls.
- Filing explanations use the available card width and wrap naturally on phones.
- The outside-spending card retains its exact source filename and downloads link
  inside its border. The Board-record link remains in the filing panel.

## Copy rules

A standalone caption, helper, source line, status or list item containing 1 sentence
has no final period, even when it wraps across several screen lines. Separate units
sharing a card do not become a paragraph. A link and its adjacent sentence tail are
1 unit. Paragraphs with 2 or more sentences, legal text and serious warnings retain
full punctuation. For example, “We couldn’t load the report information. Payment
records for this filing year are still shown.” remains a fully punctuated paragraph.

Use the source’s term consistently when naming the same reported quantity or
category, including supporting copy. Explain unfamiliar terms in plain words. Keep
the existing exception where the source term would mislead: an outgoing
“Contribution” remains “Given to other campaigns”. This is a consistency rule, not a
ban on plain-language explanations of a source term.

The lasting requirements are in
[ui-copy-guide.md](https://github.com/alethical-org/alethical/blob/main/docs/design/ui-copy-guide.md),
[design-principles.md](https://github.com/alethical-org/alethical/blob/main/docs/design/design-principles.md),
[campaign-money-section-guide.md](https://github.com/alethical-org/alethical/blob/main/docs/product-onboarding/campaign-money-section-guide.md)
and [legislator-campaign-money-guide.md](https://github.com/alethical-org/alethical/blob/main/docs/product-onboarding/legislator-campaign-money-guide.md).
