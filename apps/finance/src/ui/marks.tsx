/** Record-type marks (Design Round 22): a 26px box before a record's name, hidden
 * from screen readers because the text label stays. Place the mark and the
 * name+note block in a `.f-marked` grid (26px, 1fr) so the note aligns under the
 * name. Bills keep their bill-number code instead. */
export type RecordKind = 'person' | 'organization' | 'committee' | 'printed' | 'filing';

export function RecordMark({ kind }: { kind: RecordKind }) {
  if (kind === 'person') {
    return (
      <span className="f-mark f-mark-person" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" stroke="#0B5C72" strokeWidth="2" />
          <path
            d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21"
            stroke="#0B5C72"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (kind === 'organization') {
    return (
      <span className="f-mark" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="5" y="3" width="14" height="18" rx="1.5" stroke="#0B5C72" strokeWidth="2" />
          <path
            d="M9 8 H10 M14 8 H15 M9 12 H10 M14 12 H15 M10 21 V17 H14 V21"
            stroke="#0B5C72"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (kind === 'committee') {
    return (
      <span className="f-mark f-mark-committee" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 10 H20 V20 H4 Z M8 10 V6 H16 V10 M9 14 H15"
            stroke="#0B5C72"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (kind === 'printed') {
    return (
      <span className="f-mark f-mark-printed" aria-hidden="true">
        Aa
      </span>
    );
  }
  return (
    <span className="f-mark" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 3 H14 L18 7 V21 H6 Z M14 3 V7 H18 M9 12 H15 M9 16 H15"
          stroke="#0B5C72"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
