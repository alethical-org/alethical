import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const ENTRY = resolve(ROOT, '../index.ts');
const CHUNKS = resolve(ROOT, 'navigation/screenChunks.ts');
const ROUTE_TEXT = new Map([
  ['lib/committeeMoney.ts', 'screens/redesign/CommitteeMoneyScreen.tsx'],
  ['lib/committeePaymentsPage.ts', 'screens/redesign/CommitteePaymentsScreen.tsx'],
]);

// Two lazy screens sharing a module put that module in Expo's common download.
// Checking only the initial imports would miss the same words returning there.
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const suffix of ['', '.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js']) {
    const candidate = `${base}${suffix}`;
    if (/\.[jt]sx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  for (const suffix of ['.web.ts', '.web.tsx', '.ts', '.tsx', '.js']) {
    const candidate = resolve(base, `index${suffix}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function imports(source: string, dynamic: boolean): string[] {
  const parsed = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (!dynamic && ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      const hasValue =
        !clause ||
        (!clause.isTypeOnly &&
          (clause.name ||
            !names ||
            ts.isNamespaceImport(names) ||
            names.elements.some((element) => !element.isTypeOnly)));
      if (hasValue && ts.isStringLiteral(node.moduleSpecifier)) {
        result.push(node.moduleSpecifier.text);
      }
    } else if (!dynamic && ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const names = node.exportClause;
      const hasValue =
        !names ||
        !ts.isNamedExports(names) ||
        names.elements.some((element) => !element.isTypeOnly);
      if (hasValue && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        result.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((dynamic ? isDynamic : isRequire) && ts.isStringLiteral(node.arguments[0])) {
        result.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

const valueImportCache = new Map<string, string[]>();

function graph(entry: string, extraImports = new Map<string, string>()): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!valueImportCache.has(file)) {
      valueImportCache.set(file, imports(readFileSync(file, 'utf8'), false));
    }
    for (const specifier of [
      ...valueImportCache.get(file)!,
      ...imports(extraImports.get(file) ?? '', false),
    ]) {
      const target = resolveImport(file, specifier);
      if (target) queue.push(target);
    }
  }
  return seen;
}

function boundaries(extraImports = new Map<string, string>()) {
  const initial = graph(ENTRY, extraImports);
  const screens = new Set(
    imports(readFileSync(CHUNKS, 'utf8'), true).map((specifier) =>
      resolveImport(CHUNKS, specifier)!,
    ),
  );
  const graphs = new Map([...screens].map((screen) => [screen, graph(screen, extraImports)]));
  return [...ROUTE_TEXT].map(([text, owner]) => ({
    text,
    initial: initial.has(resolve(ROOT, text)),
    screens: [...graphs]
      .filter(([, files]) => files.has(resolve(ROOT, text)))
      .map(([screen]) => screen.replace(`${ROOT}/`, ''))
      .sort(),
    expectedOwner: owner,
  }));
}

describe('committee-only words download with their own screen', () => {
  it('keeps each text module outside the initial program and every other screen', () => {
    for (const result of boundaries()) {
      expect(result.initial, result.text).toBe(false);
      expect(result.screens, result.text).toEqual([result.expectedOwner]);
    }
  });

  it('catches an address reader importing committee sentences', () => {
    const extra = new Map([
      [resolve(ROOT, 'navigation/webRoutes.ts'), "import '../lib/committeeMoney';"],
    ]);
    expect(
      boundaries(extra).find((result) => result.text === 'lib/committeeMoney.ts')?.initial,
    ).toBe(true);
  });

  it('catches a second screen moving committee sentences into the common download', () => {
    const extra = new Map([
      [
        resolve(ROOT, 'screens/redesign/HomeSignedOutScreen.tsx'),
        "import '../../lib/committeeMoney';",
      ],
    ]);
    expect(
      boundaries(extra).find((result) => result.text === 'lib/committeeMoney.ts')?.screens,
    ).toEqual([
      'screens/redesign/CommitteeMoneyScreen.tsx',
      'screens/redesign/HomeSignedOutScreen.tsx',
    ]);
  });

  it('distinguishes runtime imports from types and screen downloads', () => {
    const source = `
      import type { A } from './types';
      import { type B } from './alsoTypes';
      export type { C } from './moreTypes';
      export { type D } from './lastTypes';
      import { value, type E } from './value';
      export * from './reexport';
      import './sideEffect';
      const lazy = () => import('./screen');
      const loaded = require('./required');
    `;
    expect(imports(source, false)).toEqual(['./value', './reexport', './sideEffect', './required']);
    expect(imports(source, true)).toEqual(['./screen']);
  });
});
