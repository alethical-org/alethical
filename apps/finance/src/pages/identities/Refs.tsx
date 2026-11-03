import type { ReactNode } from 'react';

const REFERENCE = /((?:ORG|PER)-\d{4,})/;

/** Text with each identity reference (ORG-0042) kept on 1 line: a line never breaks
 * at a reference's hyphen. The characters stay as served, so a copied reference is
 * exact. */
export function Refs({ children }: { children: string }): ReactNode {
  const parts = children.split(REFERENCE);
  if (parts.length === 1) return children;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="f-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
