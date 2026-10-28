// Finance never links to alethical.com (docs/architecture/alethical-finance-architecture.md
// §7). The source test (src/__tests__/noAlethicalLinks.test.ts) reads Finance's own
// files; this reads what Finance's production build ships, so code that arrives through
// @alethical/shared is covered too. Run it after `pnpm run build`.
//
// It fails on:
// - the alethical.com domain anywhere in a shipped text file, except an email address on
//   it (a contact action) and https://api.alethical.com (the data service), the same
//   allowances the source test makes;
// - a path-only link to an alethical.com page: a string in the shipped code naming a
//   path whose first segment is one of alethical.com's page routes (/money/, /bills/,
//   /legislators/, /blog/, /read/ ...) unless it is exactly 1 of Finance's own addresses
//   in src/routes.ts. Finance builds its own links from those patterns, because a
//   hand-written `/bills/${id}` cannot be told apart from alethical.com's. The 4
//   Supabase sign-in server paths below are the only exception, and only straight
//   after a `${...}`, where Supabase writes them after its own server's address.
// Source maps are skipped: they carry the original files, comments included, for
// debugging, and no reader follows them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const APP = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(APP, '..', '..');
const ALETHICAL_ROUTE_FILES = ['webRoutes.ts', 'links.ts'].map((name) =>
  join(REPO, 'apps', 'frontend', 'src', 'navigation', name),
);
const ALETHICAL_VERCEL_CONFIG = join(REPO, 'vercel.json');
// Supabase's sign-in library calls these on its own server, as `${url}/admin/users`.
const SUPABASE_SERVER_PATHS = new Set([
  '/admin/users',
  '/admin/generate_link',
  '/admin/oauth/clients',
  '/admin/custom-providers',
]);
const FINANCE_ROUTES = join(APP, 'src', 'routes.ts');
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.txt',
  '.json',
  '.svg',
  '.xml',
  '.webmanifest',
]);
const PATH = /(?<![\w./:%-])\/([a-z0-9][a-z0-9-]*)(?:\/[^\s"'<>()`?#]*)?/gi;

function parse(file, text) {
  const kind = /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** Every string a file writes, marking the template parts that follow a `${...}`. */
function stringsIn(source) {
  const strings = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) {
      strings.push({ text: node.text, afterSubstitution: false });
    } else if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      strings.push({ text: node.text, afterSubstitution: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings;
}

/**
 * alethical.com's page routes, read from its own route code and its Vercel redirects: the
 * first segment of every path the code writes, matches with a regular expression, or
 * compares a first segment against, and of every redirect's source address.
 */
export function alethicalRouteSegments(
  files = ALETHICAL_ROUTE_FILES,
  vercelConfig = ALETHICAL_VERCEL_CONFIG,
) {
  const segments = new Set();
  const add = (text, start) => {
    const match = start.exec(text);
    if (match) segments.add(match[1].toLowerCase());
  };
  for (const file of files) {
    const source = parse(file, readFileSync(file, 'utf8'));
    for (const { text } of stringsIn(source)) add(text, /^\/([a-z0-9][a-z0-9-]*)/i);
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
        add(node.text, /^\/\^\\\/([a-z0-9][a-z0-9-]*)/i);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      ) {
        for (const [left, right] of [
          [node.left, node.right],
          [node.right, node.left],
        ]) {
          if (left.getText(source) === 'segments[0]' && ts.isStringLiteral(right)) {
            segments.add(right.text.toLowerCase());
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const { source } of JSON.parse(readFileSync(vercelConfig, 'utf8')).redirects ?? []) {
    add(source, /^\/([a-z0-9][a-z0-9-]*)/i);
  }
  for (const known of ['money', 'bills', 'legislators', 'blog', 'read']) {
    if (!segments.has(known)) {
      throw new Error(
        `alethical.com's route code no longer shows /${known}; update alethicalRouteSegments.`,
      );
    }
  }
  return segments;
}

/** Finance's own addresses, the `pattern` of every route in src/routes.ts. */
export function financePatterns(file = FINANCE_ROUTES) {
  const source = parse(file, readFileSync(file, 'utf8'));
  const patterns = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'pattern' &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      patterns.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (patterns.length < 5) throw new Error(`Found only ${patterns.length} routes in ${file}.`);
  return patterns;
}

function isFinanceAddress(path, patterns) {
  const actual = path.split('/');
  return patterns.some((pattern) => {
    const expected = pattern.split('/');
    return (
      path === pattern ||
      (expected.length === actual.length &&
        expected.every((part, index) =>
          part.startsWith(':') ? actual[index] !== '' : part === actual[index],
        ))
    );
  });
}

/**
 * Every problem in the shipped files, as "file: rule: text".
 * @param {{ name: string, text: string }[]} files
 */
export function builtLinkProblems(files, { segments, patterns }) {
  const problems = [];
  for (const { name, text } of files) {
    const extension = extname(name);
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const kept = text
      .replace(/[\w.+-]+@alethical\.com/gi, '')
      .replace(/https:\/\/api\.alethical\.com/gi, '');
    for (const match of kept.matchAll(/.{0,40}alethical\.com.{0,40}/gi)) {
      problems.push(`${name}: names the alethical.com domain: ${match[0]}`);
    }
    const strings =
      extension === '.js' || extension === '.mjs'
        ? stringsIn(parse(name, text))
        : [{ text, afterSubstitution: false }];
    for (const { text: value, afterSubstitution } of strings) {
      for (const match of value.matchAll(PATH)) {
        if (
          afterSubstitution &&
          match.index === 0 &&
          SUPABASE_SERVER_PATHS.has(match[0].replace(/\/$/, ''))
        ) {
          continue;
        }
        if (segments.has(match[1].toLowerCase()) && !isFinanceAddress(match[0], patterns)) {
          problems.push(`${name}: names an alethical.com page path: ${match[0]}`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** Every text file the build ships; fonts and source maps are left out. */
function shippedFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = join(folder, item.name);
    if (item.isDirectory()) return shippedFiles(path);
    if (!TEXT_EXTENSIONS.has(extname(path))) return [];
    return [{ name: relative(APP, path), text: readFileSync(path, 'utf8') }];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = join(APP, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('No built app in apps/finance/dist. Run `pnpm run build` first.');
    process.exit(1);
  }
  const files = shippedFiles(dist);
  const problems = builtLinkProblems(files, {
    segments: alethicalRouteSegments(),
    patterns: financePatterns(),
  });
  if (problems.length > 0) {
    console.error(
      `Finance's build links to alethical.com (alethical-finance-architecture.md §7):\n${problems.join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`Checked ${files.length} built files: no alethical.com address or page path.`);
}
