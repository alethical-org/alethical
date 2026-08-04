// Editorial "🔥 Hot issue" flag — the single source of truth for which bills
// carry the neutral hot-issue pill. Read by the signed-out home feed
// (In the News / Bill Activity), the Search Bills results, and the bill profile
// header. Keyed by bill.id (the bill_key, e.g. "94-2026-HF4138").
//
// Both chambers' versions of each flagged issue are listed directly, so a card
// carries the flag whichever file surfaces even where the surface has no
// companion data (the home feed and the search list both gate on bill.id
// alone). Companion ids come from the Minnesota Legislature record (the
// `/bills/{id}` `companion` field):
//   HF 4138 ↔ SF 4696  (social media accounts for minors)
//   SF 856  ↔ HF 1338  (Office of the Inspector General)
//   SF 5310 ↔ HF 5157  (bans nonconsensual AI nudification images)
// Where companion data IS available (the bill profile payload), a bill also
// inherits the flag from its linked companion — see isHotIssueBill — so the
// flag holds even if a future pair lists only one chamber's key here.
export const HOT_ISSUE_BILL_KEYS = new Set<string>([
  '94-2026-HF4138',
  '94-2026-SF4696',
  '94-2025-SF856',
  '94-2025-HF1338',
  '94-2026-SF5310',
  '94-2026-HF5157',
]);

// A bill is a hot issue when its own key is flagged, OR its linked companion's
// key is (a hot issue's companion inherits the flag). companionId is the
// companion's bill_key when the pair is linked, else null/undefined.
export function isHotIssueBill(billId: string, companionId?: string | null): boolean {
  return HOT_ISSUE_BILL_KEYS.has(billId) || (!!companionId && HOT_ISSUE_BILL_KEYS.has(companionId));
}
