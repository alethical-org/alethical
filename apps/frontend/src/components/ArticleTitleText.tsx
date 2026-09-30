/** Keep a title’s exact characters while treating each 4-digit year range as 1 word. */
export function ArticleTitleText({ title }: { title: string }) {
  return title.split(/(\b\d{4}–\d{4}\b)/u).map((part, index) =>
    /^\d{4}–\d{4}$/u.test(part) ? (
      <span key={index} style={{ whiteSpace: 'nowrap' }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}
