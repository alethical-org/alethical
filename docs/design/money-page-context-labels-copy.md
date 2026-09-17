# Money page context labels: approved copy record

<!-- describes: apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalsScreen.tsx, apps/frontend/src/screens/redesign/MoneyByRaceScreen.tsx, apps/frontend/src/screens/redesign/MoneySearchScreen.tsx, apps/frontend/src/screens/redesign/OutsideSpendingBrowseScreen.tsx, apps/frontend/src/screens/redesign/PaymentsUnderNameScreen.tsx -->

Approved 17 September 2026 for the green all-caps label below the back link on
money pages. This records changes made during the build so a future drawing uses
the current words. It is not a new design brief. Print the approved words
verbatim. Ask about missing text rather than inventing it. Propose copy
improvements separately, with their reasons; proposals are welcome.

## Lasting rule

The green label gives context the title and nearby words do not already give. It
may identify the larger section, the kind of record or the coverage of a list. It
is omitted when it only repeats the page title, the back link or a complete title
that already names both sides of a money relationship.

## Copy changes

| Address or record                                       | Previous text                    | Approved text                                                                                            |
| ------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/money/search`                                         | SEARCH RESULTS                   | Removed in the empty, loading, error and results states                                                  |
| `/money/payments` for money given                       | GAVE                             | Removed; the title names the person or group and the recipient                                           |
| `/money/payments` for money received                    | GOT PAID                         | Removed; the title names the person or group and the payer                                               |
| `/money/payments` for independent spending              | PAID BY INDEPENDENT SPENDING     | Removed; the title names the person or group and the spender                                             |
| `/money/races`                                          | CAMPAIGN MONEY                   | Removed; the title says Money by race                                                                    |
| `/money/outside-spending`                               | CAMPAIGN MONEY                   | Removed; the title says Spending by groups that are not the campaign                                     |
| A sitting member's `/legislators/<name>?tab=money` page | LEGISLATOR PROFILE               | Removed; Rep. or Sen., the district and the party supply the context                                     |
| A former member's `/legislators/<name>?tab=money` page  | LEGISLATOR PROFILE               | Retained because the page deliberately omits a current title, district and party                         |
| `/money/lobbying/lobbyists`                             | LOBBYING                         | Removed; the title says Lobbyists                                                                        |
| `/money/lobbying/principals`                            | LOBBYING                         | Retained because Principals alone does not explain that these are organisations represented by lobbyists |
| A lobbying principal record                             | PRINCIPAL · ENTITY ID `<number>` | LOBBYING PRINCIPAL · ENTITY ID `<number>`                                                                |

## Labels retained without a wording change

- `/money/committees` keeps CAMPAIGN MONEY because Committees can also mean
  legislative committees.
- A campaign-money record keeps its official account-kind label because the
  person's or group's name does not identify the kind of registered account.
- A full committee payment list keeps EVERY DONOR NAMED or EVERY PAYMENT NAMED
  because the label states the list's coverage.
- A lobbyist record keeps LOBBYIST · REGISTRATION `<number>` because it identifies
  the record kind and the Board registration.
- An outside-spending subject record keeps its subject-kind and Board registration
  row because the subject's name alone does not provide either fact.
- A missing-record state keeps a record-kind label when the missing name cannot
  provide that context.

The lasting copy rules are in
[ui-copy-guide.md](https://github.com/alethical-org/alethical/blob/main/docs/design/ui-copy-guide.md).
