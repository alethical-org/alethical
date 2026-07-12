# Alethical Frontend Screen System Design

Status: v1 design draft

> **MVP scope:** V1 ships a **responsive web app only**. Native iOS and Android are
> post-MVP ([#91](https://github.com/alethical-org/alethical/issues/91); see
> `docs/v1-scope.md` § Frontend Scope). The iOS/Android and native "Mobile" guidance in
> this doc describes those post-MVP client targets — for the MVP it informs the web app's
> mobile-web (small-viewport) layout, not a separate native app.

## Goal

Define the v1 screen system for the shared React Native codebase. The MVP target is:

- Web (responsive: desktop + mobile-web breakpoints)

with iOS and Android as post-MVP targets on the same codebase. The goal is one coherent
product across platforms, not three unrelated apps.

## What Good Means

The frontend is acceptable only if it meets all of these standards.

### 1. User-Centered Utility

- the primary question on every screen is obvious
- the next useful action is visible without hunting
- legislative information is explained in plain language without hiding the official record
- public and signed-in flows feel consistent
- a civically engaged non-expert should be able to understand the screen without knowing legislative jargon

### 2. Accessibility

- minimum AA contrast
- dynamic type support
- screen-reader labels on all controls
- keyboard navigation on web
- visible focus states on web
- touch targets at least 44x44 on mobile
- motion is optional and never required for comprehension
- color is never the only indicator of status

### 3. Seamless Feature Access

- core surfaces should be reachable in 1 to 2 navigation steps
- a user can move from bill to legislator to chat to tracked state without losing context
- signed-in actions should not feel bolted on
- source links must always be close to AI summaries and citations

### 4. Information Hierarchy

- official facts first
- AI interpretation second
- provenance always visible
- dense legislative detail should be chunked into scannable sections

### 5. Aesthetic Utility

- calm, credible, civic tone
- clear typography with strong contrast and spacing
- avoid generic “dashboard sludge”
- use visual emphasis to guide attention, not decorate
- the design should feel trustworthy before it feels flashy

### 6. Cross-Platform Integrity

- the same domain objects should look recognizably the same across web and mobile
- navigation patterns may differ by platform, but naming and structure should not
- web should support denser side-by-side layouts
- mobile should prioritize one strong vertical flow at a time

## Design Principles

### Official Record First

- bill status, sponsors, versions, votes, and source links lead
- AI summaries sit in clearly marked panels

### Accessibility Over Exhaustiveness

- the app should reduce cognitive load, not mirror the legislature website
- long official text should be summarized, chunked, or linked out before it is ever dumped inline
- primary screens should answer “what is this, why does it matter, and what can I do next?”
- full legislative text is a source artifact, not the default reading experience

### Briefing, Not Analysis Sprawl

- the default bill page should feel like a civic briefing
- do not stack many separate AI sections just because they are available
- if a user wants deeper interpretation or more speculative framing, route that into chat
- the page should privilege clarity and confidence over exhaustive analysis modules

### Guided Questions Over Default Overload

- deeper AI analysis should often be exposed as suggested questions rather than pre-rendered sections
- suggested questions should seed chat with grounded prompts tied to the current bill or legislator
- this preserves discoverability without forcing every user through a wall of analysis

### Progressive Disclosure

- list screens show only the information needed to choose
- detail screens open secondary tabs for deeper legislative context

### Context Preservation

- when a user starts chat from a bill or legislator, that subject remains visible
- when a user returns from chat, search, or tracking flows, prior scroll/filter state should persist

### One Shared Design Language

- same bill card, legislator card, status chip, citation block, and source link treatment across platforms

## Navigation Model

## Mobile

- bottom tabs for top-level product areas
- stack navigation inside each tab

Tabs:

- Home
- Search
- Tracked
- Chat
- Account

## Web

- persistent left navigation
- top utility bar
- main content pane
- optional right context pane on detail and chat surfaces

## Shared Component Primitives

- App header
- Search bar
- Filter chips
- Bill card
- Legislator card
- Status chip
- Source link row
- AI summary card
- Citation block
- Empty state card
- Inline error state
- Tracked toggle

## Screen Inventory

- Launch and auth
- Home
- Global search
- Bill list
- Bill detail
- Vote detail
- Legislator directory
- Legislator profile
- Find my legislator
- Tracked bills
- Chat session list
- Chat session detail
- Account and settings
- Saved places
- Notifications
- Web admin and operations

## 1. Launch And Auth

### Mobile

```text
+--------------------------------------------------+
| Alethical                                        |
| Minnesota legislative intelligence               |
|                                                  |
| [ Search Bills ]                                 |
| [ Find My Legislator ]                           |
|                                                  |
| ---------------- or ----------------             |
|                                                  |
| [ Continue with Supabase Auth ]                  |
|                                                  |
| By signing in you can track bills, save places,  |
| and use grounded chat with citations.            |
+--------------------------------------------------+
```

### Web

```text
+----------------------+-------------------------------------------+
| Alethical            | Minnesota legislative intelligence        |
|                      |                                           |
| Civic clarity, bill  | [ Search Bills ] [ Find My Legislator ]  |
| tracking, and        |                                           |
| grounded AI chat.    | [ Continue with Supabase Auth ]          |
|                      |                                           |
|                      | Signed-in features: tracked bills, chat,  |
|                      | saved places, notifications.              |
+----------------------+-------------------------------------------+
```

## 2. Home

### Mobile

```text
+--------------------------------------------------+
| Alethical                              [ profile ]|
| [ Search bills, legislators...                ] |
|                                                  |
| Quick Actions                                    |
| [ Find My Legislator ] [ Tracked Bills ]         |
|                                                  |
| Current Session                                  |
| 94th Legislature (2025-2026)                     |
|                                                  |
| Recent Bills                                     |
| +----------------------------------------------+ |
| | SF 1832  Jobs omnibus                        | |
| | Senate | In committee | Updated 2d ago       | |
| | Chief sponsors: ...                 [Track]  | |
| +----------------------------------------------+ |
| +----------------------------------------------+ |
| | SF 2483  Higher education omnibus            | |
| +----------------------------------------------+ |
|                                                  |
| Explore by Topic                                 |
| [ Education ] [ Labor ] [ Health ] [ Budget ]   |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Nav              | Alethical                                       [Account] |
| Home             | [ Search bills, legislators...                        ]    |
| Search           |                                                           |
| Tracked          | +--------------------+ +------------------------------+   |
| Chat             | | Find My Legislator | | Current Session Snapshot     |   |
| Account          | | [ Start ]          | | 2,432 bills   170 members    |   |
|                  | +--------------------+ +------------------------------+   |
|                  |                                                           |
|                  | Recent Bills                                              |
|                  | +------------------------------------------------------+  |
|                  | | bill card                                            |  |
|                  | +------------------------------------------------------+  |
|                  | | bill card                                            |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 3. Global Search

> **Superseded for v1:** the combined Bills + Legislators search below is being split
> into two dedicated screens (`docs/mvp-redesign-plan.md` § Search page split). The bill
> search screen is specified in `docs/bill-search-screen-spec.md`, which is authoritative
> for v1; the legislator screen follows separately. The layout here is retained as
> historical context.

### Pagination Behavior

The Bills column uses server-backed pagination. Each page request sends the active filters plus `limit` and `offset`; the UI advances only when the API returns `page.has_more=true`. The screen must not fetch a single bounded bill list and slice it locally, because that caps search results at the first response window.

### Mobile

```text
+--------------------------------------------------+
| Search                                           |
| [ jobs omnibus                               x ] |
| [ Bills ] [ Legislators ] [ All ]                |
|                                                  |
| Bills                                            |
| +----------------------------------------------+ |
| | SF 1832  Jobs omnibus                        | |
| +----------------------------------------------+ |
|                                                  |
| Legislators                                      |
| +----------------------------------------------+ |
| | Sen. Fateh  District 62  D                    | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Nav              | Search                                                    |
|                  | [ jobs omnibus                                        ]   |
|                  | [ All ] [ Bills ] [ Legislators ]                         |
|                  |                                                           |
|                  | +---------------------------+ +------------------------+  |
|                  | | Bills                     | | Legislators            |  |
|                  | | result list               | | result list            |  |
|                  | +---------------------------+ +------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 4. Bill List

> **See `docs/bill-search-screen-spec.md`** for the authoritative v1 bill search screen.
> The Sort control and Export button sketched below are not in v1 scope (order is fixed
> to latest legislative action); this section predates the current build.

### Mobile

```text
+--------------------------------------------------+
| Bills                                            |
| [ Search bills...                            ]   |
| [ Session ] [ Chamber ] [ Status ] [ Topic ]    |
| [ Omnibus ] [ Sort ]                             |
|                                                  |
| +----------------------------------------------+ |
| | SF 1832                                      | |
| | Jobs omnibus                                 | |
| | Senate | In committee | 29 actions           | |
| | Chief sponsors: Champion, Fateh      [Track] | |
| +----------------------------------------------+ |
| +----------------------------------------------+ |
| | SF 2483                                      | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Filters          | Bills                                          [Export]   |
| Session          | [ Search bills...                               ]         |
| Chamber          | [ Session ] [ Chamber ] [ Status ] [ Topic ] [ Sort ]    |
| Status           |                                                           |
| Topic            | +------------------------------------------------------+  |
|                  | | Bill | Title | Status | Sponsors | Updated | Track |  |
|                  | |------------------------------------------------------|  |
|                  | | SF1832 | Jobs omnibus | ...                         |  |
|                  | | SF2483 | Higher ed omnibus | ...                    |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 5. Bill Detail

### Mobile

```text
+--------------------------------------------------+
| < Bills                            [Track] [Share]|
| SF 1832                                          |
| Jobs, Labor, Economic Development omnibus        |
| Senate | In committee | Updated Mar 19           |
|                                                  |
| [ Summary ] [ Actions ] [ Versions ] [ Votes ]   |
|                                                  |
| What This Bill Does                              |
| Uses state funding to support jobs and economic  |
| development programs.                            |
|                                                  |
| Why It Matters                                   |
| Affects how Minnesota funds workforce programs   |
| and related public services.                     |
|                                                  |
| Key Changes                                      |
| - Workforce funding changes                      |
| - Grant program updates                          |
| - Reporting requirements                         |
|                                                  |
| Who Is Affected                                  |
| Workers, employers, agencies, training groups    |
|                                                  |
| Supporters May Say                               |
| Better funding and program clarity               |
|                                                  |
| Concerns Some May Raise                          |
| Cost, scope, or implementation concerns          |
|                                                  |
| Suggested Questions                              |
| [ Arguments for and against ]                    |
| [ Who is most affected? ]                        |
| [ What does it spend? ]                          |
| [ How does it change current law? ]              |
|                                                  |
| [ View citations ] [ Official source ]           |
|                                                  |
| Chief Sponsors                                   |
| Champion, Fateh                                  |
|                                                  |
| Key Details                                      |
| 29 actions | 7 versions | 0 roll calls           |
|                                                  |
| [ Open Chat About This Bill ]                    |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Nav              | SF 1832                                      [Track]      |
|                  | Jobs, Labor, Economic Development omnibus                  |
|                  | Senate | In committee | Updated Mar 19                    |
|                  |                                                           |
|                  | [ Summary ] [ Actions ] [ Versions ] [ Votes ] [ Chat ]  |
|                  |                                                           |
|                  | +----------------------------------+ +------------------+ |
|                  | | What This Bill Does             | | Bill Snapshot    | |
|                  | | Why It Matters                  | | Sponsors         | |
|                  | | Key Changes                     | | Status           | |
|                  | | Who Is Affected                 | | Versions         | |
|                  | | Supporters May Say              | | Topic chips      | |
|                  | | Concerns Some May Raise         | | Key sections     | |
|                  | | Suggested Questions             | |                  | |
|                  | | [ arguments ] [ affected groups]| |                  | |
|                  | | [ spending ] [ current law ]    | |                  | |
|                  | | [ citations ]                   | |                  | |
|                  | +----------------------------------+ +------------------+ |
|                  |                                                           |
|                  | Source Links                                              |
|                  | [ Official bill page ] [ Official text ] [ Journal ]     |
+------------------+-----------------------------------------------------------+
```

## 6. Vote Detail

### Mobile

```text
+--------------------------------------------------+
| < Bill Votes                                     |
| Vote Event                                       |
| Motion: Third reading                            |
| Result: Passed 67-0                              |
|                                                  |
| [ Yes 67 ] [ No 0 ] [ Absent 0 ]                 |
|                                                  |
| +----------------------------------------------+ |
| | Sen. Champion                         YES     | |
| +----------------------------------------------+ |
| | Sen. Fateh                            YES     | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Bill Context     | Vote Event                                                 |
| SF 1832          | Motion: Third reading                                      |
|                  | Result: Passed 67-0                                        |
|                  |                                                           |
|                  | +------------------------------------------------------+  |
|                  | | Legislator | Party | District | Vote                  |  |
|                  | |------------------------------------------------------|  |
|                  | | Champion   | D     | 43       | YES                  |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

### Bill Detail Content Rules

The default bill page should include at most these AI-supported briefing blocks:

- What this bill does
- Why it matters
- Key changes
- Who is affected
- Supporters may say
- Concerns some may raise

Do not show these as default standalone sections on the bill page:

- talking points
- sentiment analysis
- bias detection
- environmental impact
- alternative policy approaches
- long multi-domain impact modules
- speculative forecasts without strong sourcing

Those can be generated on demand in chat, where the user has explicitly asked for them.

Recommended seeded bill prompts:

- What are the main arguments for and against this bill?
- Who would be most affected by this bill?
- What does this bill spend, and where does the money go?
- How does this bill differ from current law?
- Give me clear talking points about this bill.

## 7. Legislator Directory

### Mobile

```text
+--------------------------------------------------+
| Legislators                                      |
| [ Search name, district, party...           ]   |
| [ Chamber ] [ Party ] [ District ]               |
|                                                  |
| +----------------------------------------------+ |
| | Sen. Fateh                                   | |
| | Senate | District 62 | D                     | |
| | 12 bills | 4 committees                      | |
| +----------------------------------------------+ |
| +----------------------------------------------+ |
| | Rep. Pinto                                   | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Filters          | Legislators                                                |
| Chamber          | [ Search name, district, party...                     ]    |
| Party            | [ Chamber ] [ Party ] [ District ]                         |
| District         |                                                           |
|                  | +------------------------------------------------------+  |
|                  | | Legislator | Chamber | District | Party | Stats       |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 8. Legislator Profile

### Authored Bills Pagination Behavior

Authored Bills uses the same server-backed `limit` and `offset` contract as the bill search list. The legislator stats card may show more bills than the current page contains, so the profile must keep Previous/Next controls available while the endpoint reports `page.has_more=true`.

### Mobile

```text
+--------------------------------------------------+
| < Legislators                                    |
| Sen. Fateh                                       |
| Senate | District 62 | D                         |
| [ Contact ] [ Track Bills ]                      |
|                                                  |
| [ Overview ] [ Bills ] [ Votes ] [ Committees ]  |
|                                                  |
| Current Service                                  |
| Email                                            |
| Office phone                                     |
| Office address                                   |
|                                                  |
| Stats                                            |
| 12 authored bills | 4 committees                 |
|                                                  |
| Suggested Questions                              |
| [ What bills has this legislator authored? ]     |
| [ How has this legislator voted? ]               |
| [ What issues do they focus on? ]                |
| [ Explain this legislator's recent activity ]    |
|                                                  |
| [ Ask Chat About This Legislator ]               |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Nav              | Sen. Fateh                                                 |
|                  | Senate | District 62 | D                                   |
|                  | [ Contact ] [ Bills ] [ Votes ] [ Committees ] [ Chat ]   |
|                  |                                                           |
|                  | +----------------------------+ +------------------------+  |
|                  | | Current Service            | | Stats                  |  |
|                  | | email / phone / office     | | bills / votes / comm. |  |
|                  | | Suggested Questions        | |                        |  |
|                  | | [ authored bills ]         | |                        |  |
|                  | | [ voting record ]          | |                        |  |
|                  | +----------------------------+ +------------------------+  |
|                  |                                                           |
|                  | Authored Bills                                              |
|                  | +------------------------------------------------------+  |
|                  | | bill card                                            |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 9. Find My Legislator

### Mobile

```text
+--------------------------------------------------+
| Find My Legislator                               |
| [ Enter address or city                      ]   |
| [ Use Current Location ] [ Drop Pin On Map ]     |
| +----------------------------------------------+ |
| | map preview with draggable pin               | |
| +----------------------------------------------+ |
| [ Use Saved Place ]                              |
|                                                  |
| Result                                           |
| House District 64B                               |
| Rep. Pinto                                       |
|                                                  |
| Senate District 64                               |
| Sen. Murphy                                      |
|                                                  |
| [ Save This Place ]                              |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Saved Places     | Find My Legislator                                         |
| Home             | [ Enter address or city                              ]     |
| Work             | [ Lookup ] [ Use Map Pin ]                                |
|                  |                                                           |
|                  | +-----------------------------------------------------+   |
|                  | | map surface with pinned location                    |   |
|                  | +-----------------------------------------------------+   |
|                  |                                                           |
|                  | +---------------------------+ +------------------------+  |
|                  | | House                     | | Senate                 |  |
|                  | | district + legislator     | | district + legislator  |  |
|                  | +---------------------------+ +------------------------+  |
+------------------+-----------------------------------------------------------+
```

Requirements:

- support direct address or city entry
- support a pinned map location as an alternate lookup input
- allow users to move the pin before running lookup
- send latitude and longitude from the pinned location to the lookup API
- return the same district and legislator result shape for address and map-pin lookup
- do not require sign-in for either lookup mode
- keep the map renderer behind a component boundary so web, iOS, and Android can share the same lookup flow
- make the map tile provider configurable; production should use an approved tile provider rather than depending on public demo tile infrastructure

## 10. Tracked Bills

### Mobile

```text
+--------------------------------------------------+
| Tracked Bills                                    |
| [ All ] [ Updates ]                              |
|                                                  |
| +----------------------------------------------+ |
| | SF 1832                                      | |
| | Updated 2d ago                               | |
| | note: watch committee movement               | |
| | [ Open ] [ Untrack ]                         | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Nav              | Tracked Bills                                              |
|                  | [ Sort by latest update ]                                  |
|                  |                                                           |
|                  | +------------------------------------------------------+  |
|                  | | Bill | Latest update | Alerts | Note | Actions        |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 11. Chat Session List

### Mobile

```text
+--------------------------------------------------+
| Chat                                             |
| [ + New Chat ]                                   |
|                                                  |
| Recent                                           |
| +----------------------------------------------+ |
| | Jobs omnibus                                  | |
| | SF 1832 | Updated today                       | |
| +----------------------------------------------+ |
| | Education bill                               | |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Chat Sessions    | Chat                                                      |
| Jobs omnibus     | Select a session or start a new one.                     |
| Education bill   | [ + New Chat ]                                            |
|                  |                                                           |
|                  | Recent sessions list                                      |
+------------------+-----------------------------------------------------------+
```

## 12. Chat Session Detail

### Mobile

```text
+--------------------------------------------------+
| < Chat                                           |
| Jobs omnibus                                     |
| Subject: SF 1832                                 |
|                                                  |
| User: What does this bill do for workforce...?   |
|                                                  |
| Assistant:                                       |
| This bill appropriates funding and changes ...   |
|                                                  |
| Citations                                        |
| [ SF 1832, Article 1, Sec. 1 ]                   |
| [ Official source ]                              |
|                                                  |
| [ Ask a grounded question...                 ]   |
+--------------------------------------------------+
```

### Web

```text
+----------------------+-------------------------------------------+-----------+
| Sessions             | Chat                                      | Context   |
| Jobs omnibus         | Subject: SF 1832                          | Bill info |
| Education bill       |                                           | Source    |
|                      | User / assistant transcript               | links     |
|                      |                                           | Citations |
|                      | [ Ask a grounded question...         ]    |           |
+----------------------+-------------------------------------------+-----------+
```

## 13. Account And Settings

### Mobile

```text
+--------------------------------------------------+
| Account                                          |
| Ada                                              |
| ada@example.com                                  |
|                                                  |
| [ Saved Places ]                                 |
| [ Notification Settings ]                        |
| [ Chat History ]                                 |
| [ Sign Out ]                                     |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Account Nav      | Account Settings                                           |
| Profile          | ada@example.com                                            |
| Saved Places     |                                                           |
| Notifications    | [ Saved Places ] [ Notifications ] [ Sign Out ]           |
|                  |                                                           |
|                  | settings panel                                             |
+------------------+-----------------------------------------------------------+
```

## 14. Saved Places

### Mobile

```text
+--------------------------------------------------+
| Saved Places                                     |
| + Add Place                                      |
|                                                  |
| Home                                             |
| Saint Paul, MN                           Default |
| [ Edit ]                                         |
|                                                  |
| Work                                             |
| Minneapolis, MN                                  |
| [ Edit ]                                         |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Account Nav      | Saved Places                                               |
|                  | [ + Add Place ]                                            |
|                  |                                                           |
|                  | +------------------------------------------------------+  |
|                  | | Label | Address | Default | Actions                   |  |
|                  | +------------------------------------------------------+  |
+------------------+-----------------------------------------------------------+
```

## 15. Notifications

### Mobile

```text
+--------------------------------------------------+
| Notification Settings                            |
| Email updates                                    |
| [ on ]                                           |
| Frequency                                        |
| ( ) realtime                                     |
| (x) daily digest                                 |
| ( ) weekly digest                                |
+--------------------------------------------------+
```

### Web

```text
+------------------+-----------------------------------------------------------+
| Account Nav      | Notification Settings                                      |
|                  | Email channel                                              |
|                  | [ enabled ]                                                |
|                  | Frequency: realtime / daily / weekly                      |
+------------------+-----------------------------------------------------------+
```

## 16. Web Admin And Operations

### Web Only

```text
+------------------+-----------------------------------------------------------+
| Admin Nav        | Ingestion Runs                                             |
| Runs             | [ status ] [ adapter ] [ target type ]                    |
| Parser Errors    |                                                           |
| Overrides        | +------------------------------------------------------+  |
| Reprocess        | | Run ID | Adapter | Target | Status | Started | Open    | |
|                  | +------------------------------------------------------+  |
|                  |                                                           |
|                  | Selected Run / Error Detail                                |
|                  | raw payload refs, parser failures, retry actions           |
+------------------+-----------------------------------------------------------+
```

## Global Empty, Loading, And Error States

### Loading

```text
[ header ]
[ skeleton card ]
[ skeleton card ]
[ skeleton card ]
```

### Empty

```text
No tracked bills yet.
[ Explore Bills ]
```

### Error

```text
We could not load this data right now.
[ Retry ]  [ View status ]  [ Contact support ]
```

## Cross-Platform Interaction Rules

- bill cards always open bill detail
- legislator cards always open legislator profile
- tracked toggles should update optimistically with rollback on failure
- chat citations should be tappable and open either bill detail or version text in context
- suggested question chips should open chat with prefilled, grounded prompts
- source links should open external official URLs with explicit labeling

## Design Decision Summary

- web uses denser multi-pane layouts for research and operations
- mobile uses a clear tab-plus-stack structure
- AI never replaces official bill or vote data
- all core v1 features are reachable from primary navigation
- signed-in value is obvious but public browsing remains first-class

## Validation Against V1 Scope

Status: pass

Covered surfaces:

- public home and search
- bill list and filtering
- bill detail
- legislator directory
- legislator profile
- find my legislator
- user account
- tracked bills
- chat
- web operational surface

## Scope Trim Check

The screen inventory is mostly aligned with v1, but these items should be treated carefully to avoid bloat.

### Keep In Core V1

- home
- global search
- bill list
- bill detail
- legislator directory
- legislator profile
- find my legislator
- tracked bills
- chat session list and detail
- account
- saved places
- notification settings

### Reasonable Secondary V1

- vote detail
- web admin and operations

These are still consistent with v1, but they do not all need equal implementation depth at launch.

### Do Not Treat As Launch-Critical

- a full in-app bill-text reading surface
- a separate notification history screen
- an elaborate account settings area beyond sign-out, saved places, and notification preferences
- heavy multi-pane web experiences on every screen
- deep committee or vote analytics views beyond straightforward record display

### Implementation Guidance

- do not make full bill text a primary in-app reading mode
- use bill detail to explain the bill in plain language, show key sections, and link out to the official source
- ship vote detail as a drilled-in subview, not a top-level feature area
- keep the web admin surface utilitarian and internal, not product-polished
- if time gets tight, cut depth before cutting the core public bill and legislator flows

## Recommended Next Step

Turn this into:

1. a route map for React Navigation
2. a component inventory
3. a design token system
4. high-fidelity wireframes for mobile and desktop
