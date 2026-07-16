# Canonical legislator membership from the official roster PDF

**Status:** implemented (July 2026). Owning session: `legislator-roster-pdf-reconcile`.

**Net:** Our "Search legislators" list showed people who had left office (e.g. Sen. Justin Eichorn) because the data loader could *add* members but never *remove* ones who left. This change makes the Minnesota Legislature's official printable roster PDF the authority for **who is currently in office**, and adds a reconciliation step that switches off (`is_current = False`) any member the official roster no longer lists. The existing web scrape still supplies each member's details (photo, email, committees, and the profile URL our answer citations require).

## Problem

`MinnesotaIngestionPipeline.ingest_roster()` (`alethical/pipeline/minnesota.py`) scrapes the HTML roster at `leg.mn.gov/leg/legislators`, then for each member scrapes their profile page and upserts a `Legislator` + a `LegislatorServicePeriod` with `is_current = True`. It only ever *adds or updates* members present in the source. **There is no deactivation step.** When a member leaves mid-biennium (resignation, death, expulsion), nothing flips their service period off, so they linger in the directory forever — even after their successor is ingested into the same seat.

Verified against production (session `94-2025-regular`, July 2026): the directory returned **206** current members (136 House + 70 Senate) versus the correct **200** (133 House + 67 Senate). Six departed members were still `is_current = True`:

| Seat | Stale (still current in DB) | Official roster now |
|------|------------------------------|---------------------|
| senate 06 | Justin D. Eichorn | Keri Heintzeman |
| senate 29 | Bruce Douglas Anderson | Michael W. Holmstrom |
| senate 47 | Nicole Mitchell | Amanda Hemmingsen-Jaeger |
| house 34B | Melissa Hortman | Xp Lee |
| house 64A | Kaohly Vang Her | Meg Luger-Nikolai |
| house 21A | Joe Schomacker | *(seat vacant)* |

In every case the successor was already present and current; the departed member simply sat alongside them.

## Canonical source

The official **All Members Roster** PDF: `https://www.house.mn.gov/hinfo/leginfo/memroster.pdf`. It is linked as the canonical printable roster from both `senate.mn/members` ("2025-2026 All Members Roster") and `house.mn.gov/members/` ("printable roster of current legislators"). It contains **both chambers**:

- **House** (page 1): rows of `District Last, First (Party)` where district carries an A/B suffix (`45B`, `9A`); party is `(DFL)` or `(R)`; vacant seats read `Vacant` (no party).
- **Senate** (page 2): rows of `District Last, First (Party)` where district is a bare number (`35`, `6`).
- A district cross-reference grid (ignored by the parser).

The PDF is dated ("List as of M/D/YY"). Its URL is stable across biennia — it always points at the current two-year roster.

**What the PDF provides:** chamber, district, name (Last, First + middle/suffix), party.
**What it does *not* provide:** profile URLs, emails, photos, committees. Those remain sourced from the official `leg.mn.gov` member pages via the existing HTML scrape. The PDF is therefore canonical for **membership** (who is currently serving); the web scrape remains canonical for **member detail**.

## Design

### Module: `alethical/pipeline/roster_pdf.py`

Pure, testable functions plus one fetch:

- `fetch_roster_pdf_text(http=None, url=DEFAULT) -> str` — download the PDF and run `pdftotext -layout` (same subprocess pattern already used in `alethical/pipeline/votes.py:212`).
- `parse_roster_pdf(text) -> list[RosterMember]` — parse the extracted text into records. `RosterMember` is a dataclass: `chamber` (`"house"`/`"senate"`), `district_code` (normalized to match `District.code`: House `\d\dA|B` e.g. `09A`; Senate `\d\d` e.g. `06`), `last_name`, `first_name`, `party` (`"DFL"`/`"R"`).
  - House section = text between the House and Senate headers; Senate section = between the Senate header and the cross-reference grid header.
  - House regex captures `district(\d+[AB]) name (Party)`; Senate regex captures `district(\d+) name (Party)` requiring a comma in the name (each entry is `Last, First`) to reject room/phone numbers.
  - `Vacant` seats have no `(Party)` and are simply absent from the result (→ any DB member in that seat reconciles off).

### Reconciliation: `MinnesotaIngestionPipeline.reconcile_current_members(...)`

```
reconcile_current_members(session_slug=CURRENT_SESSION_SLUG, *, roster_members=None,
                          dry_run=False) -> ReconcileReport
```

1. If `roster_members` is not supplied, fetch + parse the PDF.
2. Build the canonical map: `(chamber, district_code) -> RosterMember`.
3. Load every `LegislatorServicePeriod` with `is_current = True` in the session whose district is a real district (`District.code NOT LIKE '%-unknown'`), joined to its `Legislator` and `District`.
4. For each such row, decide **keep** or **deactivate**:
   - No PDF entry for `(chamber, district)` → **deactivate** (seat vacant or gone).
   - PDF entry exists and its last-name tokens are a contiguous suffix of the DB member's normalized name tokens → **keep**.
   - Otherwise (seat now held by someone else) → **deactivate**.
5. Deactivations set `is_current = False` (never delete — identity rows, service history, and bill authorship are preserved per `docs/db-schema-system-design.md` identity/time-varying split).
6. Emit a `ReconcileReport`: `kept`, `deactivated` (with names/seats), `missing` (PDF seats with no kept DB match — signals the HTML scrape needs to run to add a new member), `pdf_total`.
7. `dry_run=True` computes and returns the report **without** writing (used to preview a production run).

**Name matching** (`_normalize_name_tokens`): NFKD-decompose and drop combining marks (diacritics), lowercase, remove apostrophes (straight `'` and curly `’`) and hyphens (join), split on whitespace, drop `.`/`,`. Match when the PDF last-name tokens equal a contiguous trailing subsequence of the DB name tokens. This handles middle initials (`Roger J. Skraba`), suffixes, multi-word surnames (`Johnson Stewart`, `Vang Her`), hyphenated names (`Luger-Nikolai`, `Pérez-Vega`), and apostrophes (`O'Driscoll` vs `O’Driscoll`). Matching is scoped within a single `(chamber, district)`, so short surnames (`Lee`) cannot collide across seats.

The `missing` list is a **warning only** — reconciliation never creates or reactivates rows; adding a brand-new member remains the HTML scrape's job (it has the profile URL/enrichment the PDF lacks). Deactivation is idempotent and safe to re-run.

### Wiring

- `scripts/load_minnesota_data.py`: add `--reconcile-roster` (run reconciliation) and `--reconcile-only`/`--dry-run` flags. The normal roster path (`ingest_roster` without `--skip-legislators`) calls `reconcile_current_members` after `ingest_roster` so every roster refresh self-heals membership.
- `justfile`: `reconcile-roster` recipe (dry-run by default; `apply=true` to write), documented for both local and `ALETHICAL_DATABASE_TARGET=production`.

### Session scope & cadence

Reconciliation targets one session (default `CURRENT_SESSION_SLUG`), mirroring the session parameterization precedent (#219).

- **Every biennium (~every 2 years):** Minnesota sessions are two-year bienniums (`94-2025-regular` = 2025–2026; next is 2027–2028). When a new biennium begins, run the full roster ingest + reconcile against the new session slug. The PDF URL does not change.
- **Mid-session removals (rare):** re-running the reconcile at any time catches a member who has dropped off the official roster. Low frequency, so it stays a manual/on-demand recipe rather than being wired into the continuous bill-sync (Oban) pipeline.

## Out of scope

- The legacy `%-unknown`-district bill-author service periods that also carry `is_current = True` (House 134, Senate 66 in prod). They are filtered out of the directory already (`District.code NOT LIKE '%-unknown'`) and carry sponsorship history; reconciliation ignores them.
- Auto-creating/reactivating members from the PDF (no enrichment data). Surfaced as a `missing` warning instead.
- Party/name *value* corrections on kept members — those continue to come from the HTML scrape.

## Verification

- Unit: `parse_roster_pdf` against a checked-in text fixture (a representative slice of `pdftotext -layout` output incl. a vacant seat, hyphenated/multi-word/diacritic names) asserts 200 members and exact fields.
- Unit/integration: `reconcile_current_members` against a seeded session with a contested seat (successor + predecessor both current), a vacated seat, and a matched seat → asserts the predecessor and vacated member deactivate, the successor and matched member stay, and `dry_run` writes nothing.
- Production: read-only dry-run prints the exact six deactivations; apply; re-query confirms 133 House + 67 Senate = 200 current, and Eichorn `is_current = False`.
