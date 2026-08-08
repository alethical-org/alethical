import { plainBillSummary } from './billDetail';

export const PUBLIC_SITE_ORIGIN = 'https://www.alethical.com';
export const SOCIAL_PREVIEW_IMAGE_URL = `${PUBLIC_SITE_ORIGIN}/social-preview.png`;

// X counts every HTTPS link as 23 characters after shortening it. Leave 1 more
// character for the space X adds between the prepared text and URL.
export const X_SHORT_LINK_LENGTH = 23;
const X_TEXT_LENGTH = 280 - X_SHORT_LINK_LENGTH - 1;

export type ShareSubject = 'bill' | 'legislator' | 'answer';

export interface ShareContent {
  subject: ShareSubject;
  title: string;
  description: string;
  url: string;
}

export interface ShareIntents {
  linkedin: string;
  x: string;
  facebook: string;
  email: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  const normalized = clean(value);
  if (normalized.length <= maxLength) return normalized;

  const shortened = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = shortened.lastIndexOf(' ');
  const wordSafe =
    lastSpace >= Math.floor(maxLength * 0.65) ? shortened.slice(0, lastSpace) : shortened;
  return `${wordSafe.trimEnd()}…`;
}

export function publicPageUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_SITE_ORIGIN}${normalizedPath}`;
}

export function buildBillShareContent({
  identifier,
  title,
  summary,
  url,
}: {
  identifier: string;
  title: string;
  summary?: string | null;
  url: string;
}): ShareContent {
  const cleanIdentifier = clean(identifier);
  const cleanTitle = clean(title);
  const description = plainBillSummary(summary ?? null, { firstSentenceOnly: true });

  return {
    subject: 'bill',
    title: `${cleanIdentifier}: ${cleanTitle}`,
    description:
      description ||
      `See what ${cleanIdentifier} would do and where it stands in the Minnesota Legislature.`,
    url,
  };
}

export function buildLegislatorShareContent({
  displayName,
  partyLabel,
  districtLine,
  url,
}: {
  displayName: string;
  partyLabel: string;
  districtLine: string;
  url: string;
}): ShareContent {
  const name = clean(displayName);
  return {
    subject: 'legislator',
    title: `${name}: ${clean(partyLabel)}, ${clean(districtLine)}`,
    description: `See ${name}’s committee assignments, chief-authored bills, and recent votes in the Minnesota Legislature.`,
    url,
  };
}

export function buildAnswerShareContent({
  question,
  url,
}: {
  question: string;
  url: string;
}): ShareContent {
  return {
    subject: 'answer',
    title: clean(question),
    description:
      'Read Alethical’s cited answer, with links to the Minnesota Legislature’s official record.',
    url,
  };
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
  };
}

export function nativeShareText(content: ShareContent, includeUrl: boolean): string {
  return [content.title, content.description, includeUrl ? content.url : null]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSocialPreviewHtml(content: ShareContent): string {
  const title = escapeHtml(content.title);
  const pageTitle = escapeHtml(`${content.title} | Alethical`);
  const description = escapeHtml(content.description);
  const url = escapeHtml(content.url);
  const image = escapeHtml(SOCIAL_PREVIEW_IMAGE_URL);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Alethical">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${image}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Alethical">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">
  </head>
  <body>
    <p><a href="${url}">Open this page on Alethical</a></p>
  </body>
</html>`;
}
