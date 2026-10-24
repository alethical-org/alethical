import { privacyContent, termsContent, type LegalDocumentContent } from './legalContent';
import type { PageSnapshot, SnapshotBlock } from './pageSnapshot';

/** The full legal text, in the same order and from the same source as the screen. */
export function legalPageSnapshot(path: '/privacy' | '/terms'): PageSnapshot {
  const content: LegalDocumentContent = path === '/privacy' ? privacyContent : termsContent;
  return {
    eyebrow: 'Legal',
    heading: content.title,
    subheading: content.meta,
    bodyHeading: '',
    body: [],
    bodyIsList: false,
    facts: [],
    sections: content.sections.map((section) => ({
      heading: [section.number, section.title].filter(Boolean).join(' '),
      blocks: section.blocks.map((block): SnapshotBlock =>
        block.kind === 'list'
          ? { kind: 'bullets', items: block.items }
          : block.kind === 'callout' && block.linkText && block.linkHref
            ? {
                kind: 'runs',
                runs: [
                  { kind: 'text', text: block.text },
                  { kind: 'externalLink', text: block.linkText, href: block.linkHref },
                  { kind: 'text', text: block.trailingText ?? '' },
                ],
              }
            : {
                kind: 'prose',
                lines: [
                  block.kind === 'callout'
                    ? `${block.text}${block.linkText ?? ''}${block.trailingText ?? ''}`
                    : block.text,
                ],
              },
      ),
    })),
    links: [],
  };
}
