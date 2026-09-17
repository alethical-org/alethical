import type { ShareContent } from './share';

// X counts every HTTPS link as 23 characters after shortening it. Leave 1 more
// character for the space X adds between the prepared text and URL.
export const X_SHORT_LINK_LENGTH = 23;
const X_TEXT_LENGTH = 280 - X_SHORT_LINK_LENGTH - 1;
export const BLUESKY_POST_LENGTH = 300;
const BLUESKY_POST_BYTES = 3000;

export interface ShareIntents {
  linkedin: string;
  x: string;
  facebook: string;
  email: string;
  whatsapp: string;
  bluesky: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  const normalized = clean(value);
  if (normalized.length <= maxLength) return normalized;

  let shortened = '';
  for (const part of graphemes(normalized)) {
    if (shortened.length + part.length > Math.max(0, maxLength - 1)) break;
    shortened += part;
  }
  shortened = shortened.trimEnd();
  const lastSpace = shortened.lastIndexOf(' ');
  const wordSafe =
    lastSpace >= Math.floor(maxLength * 0.65) ? shortened.slice(0, lastSpace) : shortened;
  return `${wordSafe.trimEnd()}…`;
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
      (part) => part.segment,
    );
  }
  // Older browsers count code points conservatively, without splitting surrogates.
  return Array.from(value);
}

function blueskyShareText(content: ShareContent): string {
  // The intent API accepts text, not a separate URL parameter. Reserve room for
  // the complete link before shortening prose. Never edit query state or cut a URL.
  // https://bsky.network/docs/intent-links/
  const proseBudget = BLUESKY_POST_LENGTH - graphemes(content.url).length - 2;
  const encoder = new TextEncoder();
  // The post schema also caps UTF-8 text at 3,000 bytes. Emoji sequences can
  // exceed that limit before reaching 300 visible characters.
  const byteBudget = BLUESKY_POST_BYTES - encoder.encode(content.url).length - 2;
  if (proseBudget <= 1 || byteBudget <= 3) return content.url;

  const fullText = clean(`${content.title}\n\n${content.description}`);
  const prose = graphemes(fullText);
  let text = fullText;
  if (prose.length > proseBudget || encoder.encode(fullText).length > byteBudget) {
    text = '';
    let bytes = 0;
    for (const part of prose.slice(0, proseBudget - 1)) {
      const partBytes = encoder.encode(part).length;
      if (bytes + partBytes > byteBudget - 3) break;
      text += part;
      bytes += partBytes;
    }
    text = text ? `${text.trimEnd()}…` : '';
  }
  // For very long links, send the URL alone. Bluesky detects link facets and
  // shortens their displayed text while keeping the original destination:
  // bluesky-social/social-app: composer/state/composer.ts + rich-text-manip.ts.
  return text ? `${text}\n\n${content.url}` : content.url;
}

export function buildShareIntents(content: ShareContent): ShareIntents {
  const enc = encodeURIComponent;
  const xText = truncateAtWord(`${content.title}\n\n${content.description}`, X_TEXT_LENGTH);
  const emailBody = `${content.title}\n\n${content.description}\n\n${content.url}\n\nShared from Alethical`;

  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(content.url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(xText)}&url=${enc(content.url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(content.url)}`,
    email: `mailto:?subject=${enc(content.title)}&body=${enc(emailBody)}`,
    whatsapp: `https://wa.me/?text=${enc(nativeShareText(content, true))}`,
    bluesky: `https://bsky.app/intent/compose?text=${enc(blueskyShareText(content))}`,
  };
}

export function nativeShareText(content: ShareContent, includeUrl: boolean): string {
  return [content.title, content.description, includeUrl ? content.url : null]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}
