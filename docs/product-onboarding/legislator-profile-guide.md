# How a legislator profile works

<!-- describes: apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/components/legislator/*.tsx, apps/frontend/src/lib/legislatorProfile.ts -->

A legislator profile joins public identity, committee work, bills, service history,
contact information, and other source-backed records in 1 readable page. The page adds
context, but the Minnesota Legislature remains the source of record.

## Identity

The heading uses the official title and name. The district line leads with place and
spells out the chamber, such as **Minneapolis · Senate District 62**. Party names are
spelled out and use a neutral grey badge. Alethical does not use red, blue, or its green
action color to suggest a view of a party.

The portrait, office, phone, and official profile link come from the member's House or
Senate record. Missing fields disappear instead of showing made-up examples.

## Committees and bills

Current committee assignments show the committee name. A verified leadership role, such
as Chair, Vice Chair, Co-Chair, or Ranking Minority Member, gets a separate leadership
badge. A normal assignment gets no empty badge.

The bill section shows up to 2 current-session bills for which the member is a chief
author. **See more** opens that member's official chief-author list on the Minnesota
Revisor website. Past-session archives remain a planned feature and are shown only as
such.

Preset questions come from issues on bills the member authored. They describe those bills,
not the member's beliefs or priorities. A question that the current records cannot answer
must not appear.

## Legislative service

Service history is a list, not 1 election year. Each chamber tenure gets its own line in
the official order, followed by the current chamber's term count. A member who served in
the House and later the Senate keeps both election lines, while **Term** counts only the
current chamber.

For example, a member can show:

- **Elected to the House:** 2012, re-elected 2014, 2016, 2018, 2020
- **Elected to the Senate:** 2022
- **Term:** 1st

House and Senate records have different addresses, photos, biography fields, and
chief-author links. The page uses the source for that chamber instead of forcing both
through 1 guessed format.

## Public money records

When available, a profile can show source-backed campaign and outside-spending records.
The meaning and safe empty states for outside spending live in
[`outside-spending-guide.md`](outside-spending-guide.md). Money figures never come from a
design sample.

## Share and planned features

Share uses the legislator's public Alethical address and the common rules in
[`sharing-guide.md`](sharing-guide.md).

Planned profile claiming and vote explanations are clearly labelled **ON THE ROADMAP**.
Their examples are not interactive. Alethical must not offer a button that looks usable
before the feature exists.

## Lasting source of truth

This guide owns the profile's product behavior. The shared visual and accessibility rules
live in [`design-principles.md`](../design/design-principles.md). Exact rendering lives in
`LegislatorProfileWebScreen.tsx`, `LegislatorProfileMobileScreen.tsx`, and the shared
legislator components. Design previews are temporary working files and are not permanent
product records.
