import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  askPageMetadata,
  billListPageMetadata,
  billPageMetadata,
  HEAD_MARKER_END,
  HEAD_MARKER_START,
  homePageMetadata,
  injectPageHead,
  legislatorListPageMetadata,
  legislatorPageMetadata,
  renderPageHead,
  STATIC_PAGE_METADATA,
} from '../share';

// The head block is HTML, so Prettier reformats it in the template and not in the
// generated string. Comparing the tags with whitespace collapsed, and the
// machine-readable blocks as parsed objects, tests the values rather than the
// line breaks.
function splitHead(html: string) {
  const blocks: unknown[] = [];
  const tags = html.replace(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    (_match, body: string) => {
      blocks.push(JSON.parse(body));
      return '';
    },
  );
  return { tags: tags.replace(/\s+/g, ' ').trim(), blocks };
}

describe('page metadata', () => {
  it('names the bill in the title, with its session year', () => {
    const meta = billPageMetadata({
      billId: '94-2025-HF719',
      shortTitle: 'Statewide Capital Projects and Bonding Bill',
      summary: 'Authorizes borrowing for public buildings. More detail follows.',
    });

    expect(meta.title).toBe(
      'HF 719 (2025): Statewide Capital Projects and Bonding Bill | Alethical',
    );
    expect(meta.canonicalPath).toBe('/bills/94-2025-HF719');
    expect(meta.description).toBe('Authorizes borrowing for public buildings.');
    expect(meta.noindex).toBe(false);
  });

  it('names the person in a legislator title, without their party', () => {
    const meta = legislatorPageMetadata({
      slug: 'aisha-gomez',
      displayName: 'Rep. Aisha Gomez',
      districtLine: 'House District 62A',
    });

    expect(meta.title).toBe('Rep. Aisha Gomez, Minnesota House District 62A | Alethical');
    expect(meta.canonicalPath).toBe('/legislators/aisha-gomez');
  });

  // Ten filter values combine into effectively unlimited near-identical addresses.
  // They all declare the plain list as their real one, which collapses them.
  it('points every filtered list address back at the plain list', () => {
    expect(billListPageMetadata().canonicalPath).toBe('/bills');
    expect(legislatorListPageMetadata().canonicalPath).toBe('/legislators');
  });

  // Blocking answer pages in robots.txt would stop a crawler reading the very
  // instruction that unlists them, so they are crawlable and marked noindex.
  it('marks answer pages noindex rather than blocking them', () => {
    expect(askPageMetadata('What would HF 719 fund?').noindex).toBe(true);
    expect(askPageMetadata(null).title).toBe('Ask about Minnesota legislation | Alethical');
  });

  it('gives every listed static page its own title and real address', () => {
    for (const [path, meta] of Object.entries(STATIC_PAGE_METADATA)) {
      expect(meta.canonicalPath).toBe(path);
      expect(meta.title.endsWith(' | Alethical')).toBe(true);
      expect(meta.description.length).toBeGreaterThan(0);
      // Rule 6 of the wording rules: the title carries the brand, the description
      // spends its characters on the page's own subject.
      expect(meta.description).not.toContain('Alethical');
    }
  });
});

describe('rendered head', () => {
  // 10,471 AI-written titles and summaries are 10,471 chances for one stray
  // character to break the markup or close the script element early.
  it('escapes every stored string before it reaches a tag', () => {
    const head = renderPageHead(
      billPageMetadata({
        billId: '94-2025-HF1',
        shortTitle: 'Repeals <script> "quoting" & tags',
        summary: 'Ends the </script> loophole. More follows.',
      }),
    );

    expect(head).toContain('&lt;script&gt;');
    expect(head).toContain('&quot;quoting&quot;');
    expect(head).toContain('&amp; tags');
    expect(head).not.toContain('<script>');
    expect(head).not.toContain('</script> loophole');
    // Inside the machine-readable block a raw `<` could close the element early,
    // so every one of them is escaped there too.
    const jsonLd = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(jsonLd).toBeDefined();
    expect(jsonLd).not.toContain('<');
    expect(jsonLd).toContain('\\u003cscript');
    expect(JSON.parse(jsonLd as string)).toMatchObject({ '@type': 'BreadcrumbList' });
  });

  it('describes home as a site and a publisher, and a detail page by its path', () => {
    const home = splitHead(renderPageHead(homePageMetadata())).blocks as {
      '@type': string;
    }[];
    expect(home.map((block) => block['@type'])).toEqual(['WebSite', 'Organization']);

    const bill = splitHead(
      renderPageHead(billPageMetadata({ billId: '94-2025-HF719', shortTitle: 'Bonding' })),
    ).blocks as { '@type': string; itemListElement: { item: string }[] }[];
    expect(bill).toHaveLength(1);
    expect(bill[0]['@type']).toBe('BreadcrumbList');
    expect(bill[0].itemListElement.map((step) => step.item)).toEqual([
      'https://www.alethical.com/bills',
      'https://www.alethical.com/bills/94-2025-HF719',
    ]);
  });

  // A missing page is not a copy of a real one, so it points a search engine at
  // nothing rather than at an unrelated address.
  it('omits the real-address tags when a page has no real address', () => {
    const head = renderPageHead({
      title: 'Page not found | Alethical',
      socialTitle: 'Page not found',
      description: 'No such record.',
      canonicalPath: '',
      noindex: true,
      breadcrumb: [],
    });

    expect(head).not.toContain('rel="canonical"');
    expect(head).not.toContain('og:url');
    expect(head).toContain('name="robots" content="noindex"');
  });

  it('replaces only the marked block of the page shell', () => {
    const shell = `<head>\n  ${HEAD_MARKER_START}\n  <title>old</title>\n  ${HEAD_MARKER_END}\n  <link rel="stylesheet" href="/fonts.css" />\n</head>`;
    const out = injectPageHead(shell, billListPageMetadata());

    expect(out).toContain('<link rel="stylesheet" href="/fonts.css" />');
    expect(out).not.toContain('<title>old</title>');
    expect(out).toContain('<title>Search Minnesota bills | Alethical</title>');
  });

  it('refuses a shell that has lost its markers, rather than serving it unchanged', () => {
    expect(() => injectPageHead('<head></head>', homePageMetadata())).toThrow();
  });
});

// Vercel serves `/` straight off the filesystem and never reaches a rewrite, so
// the home page's tags ship inside the template. This is what stops the two
// copies drifting apart.
describe('the shipped page shell', () => {
  const template = readFileSync(resolve(__dirname, '../../../public/index.html'), 'utf8');

  it('carries the home page head the builders generate', () => {
    const start = template.indexOf(HEAD_MARKER_START) + HEAD_MARKER_START.length;
    const end = template.indexOf(HEAD_MARKER_END);
    expect(start).toBeGreaterThan(HEAD_MARKER_START.length - 1);
    expect(end).toBeGreaterThan(start);

    const inTemplate = splitHead(template.slice(start, end));
    const generated = splitHead(renderPageHead(homePageMetadata()));

    expect(inTemplate.tags).toBe(generated.tags);
    expect(inTemplate.blocks).toEqual(generated.blocks);
  });
});
