/** Keep the partial-release scope visible without implying missing values are zero. */
export function CoverageNotice({ detailsId }: { detailsId?: string }) {
  return (
    <aside className="ec-notice" aria-label="Data coverage">
      <span>Data coverage is incomplete</span>
      {detailsId && (
        <a className="ec-link" href={`#${detailsId}`}>
          View coverage
        </a>
      )}
    </aside>
  );
}
