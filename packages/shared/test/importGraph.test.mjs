// Everything @alethical/shared re-exports must build inside Alethical Finance's Vite
// app, which has no React Native. This walks the whole import graph behind every
// subpath the package offers and fails on anything that would pull alethical.com's
// phone-first framework or its app-only code into Finance
// (docs/architecture/alethical-finance-architecture.md §2).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(PACKAGE, '..', '..');
const FRONTEND_SRC = join(REPO, 'apps', 'frontend', 'src');
const APP_ONLY_FOLDERS = ['navigation', 'providers', 'screens', 'components'].map((name) =>
  join(FRONTEND_SRC, name),
);
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
const DECLARED = new Set([
  ...Object.keys(MANIFEST.dependencies ?? {}),
  ...Object.keys(MANIFEST.peerDependencies ?? {}),
]);

// Finance's own compiler settings, read from the package's tsconfig, decide how an
// import resolves, so `./supabase` finds the file Finance's build would find.
const CONFIG = ts.getParsedCommandLineOfConfigFile(
  join(PACKAGE, 'tsconfig.json'),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(String(d.messageText)) },
).options;

const PLATFORM_FILE = /\.(web|native|ios|android)\.[cm]?[jt]sx?$/;
const PLATFORMS = ['web', 'native', 'ios', 'android'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function forbiddenPackage(name) {
  return (
    name === 'react-native' ||
    name.startsWith('react-native-') ||
    name.startsWith('@react-native') ||
    name === 'expo' ||
    name.startsWith('expo-') ||
    name.startsWith('@expo/') ||
    name.startsWith('@react-navigation/')
  );
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function inside(file, folder) {
  return file === folder || file.startsWith(folder + sep);
}

const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window']);
const EXPO_GLOBALS = new Set(['__DEV__', 'process']);

/** A read of `globalThis.__DEV__`, `window['process']` and the like, as text. */
function globalObjectRead(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || !GLOBAL_OBJECTS.has(node.expression.text)) return null;
  const name = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : null;
  return name && EXPO_GLOBALS.has(name) ? `${node.expression.text}.${name}` : null;
}

/** Every module specifier a file names, type-only and dynamic imports included. */
function readFile(file) {
  const text = readFileSync(file, 'utf8');
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const specifiers = [];
  const globals = new Set();
  const runtimeImports = new Set();
  const visit = (node) => {
    const globalRead = globalObjectRead(node);
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression)) {
        specifiers.push(reference.expression.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      // A name built at run time cannot be followed, so it cannot be cleared.
      if (node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
        specifiers.push(node.arguments[0].text);
      } else {
        runtimeImports.add(node.getText(source));
      }
    } else if (globalRead) {
      globals.add(globalRead);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      globals.add('process.env');
    } else if (
      ts.isIdentifier(node) &&
      node.text === '__DEV__' &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      globals.add('__DEV__');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, globals, runtimeImports };
}

/** Each problem names the rule and the import chain from the entry to the file. */
function importGraphProblems(entry, { appOnlyFolders = APP_ONLY_FOLDERS } = {}) {
  const problems = new Set();
  const parent = new Map([[entry, null]]);
  const queue = [entry];
  const chain = (file) => {
    const steps = [];
    for (let step = file; step; step = parent.get(step)) steps.unshift(relative(REPO, step));
    return steps.join(' -> ');
  };
  const report = (file, rule) => problems.add(`${rule}: ${chain(file)}`);

  while (queue.length > 0) {
    const file = queue.shift();
    if (appOnlyFolders.some((folder) => inside(file, folder))) {
      report(file, "reaches alethical.com's app-only code");
      continue;
    }
    const base = file.replace(/\.[cm]?[jt]sx?$/, '');
    const twin = PLATFORMS.flatMap((platform) =>
      EXTENSIONS.map((ext) => `${base}.${platform}${ext}`),
    ).filter(existsSync);
    if (PLATFORM_FILE.test(file) || twin.length > 0) {
      report(
        file,
        "has a platform-specific twin, so alethical.com's build reads a different file than Finance's",
      );
    }
    const { specifiers, globals, runtimeImports } = readFile(file);
    for (const name of globals) {
      report(file, `reads ${name}, which only alethical.com's Expo build defines`);
    }
    for (const call of runtimeImports) {
      report(file, `imports a module named only at run time, ${call}`);
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const resolved = ts.resolveModuleName(specifier, file, CONFIG, ts.sys).resolvedModule;
        if (!resolved) {
          report(file, `imports '${specifier}', which Finance's build cannot find`);
        } else if (!parent.has(resolved.resolvedFileName)) {
          parent.set(resolved.resolvedFileName, file);
          queue.push(resolved.resolvedFileName);
        }
        continue;
      }
      const name = packageName(specifier);
      if (forbiddenPackage(name)) {
        report(file, `imports ${name}`);
      } else if (!DECLARED.has(name)) {
        report(file, `imports ${name}, which packages/shared/package.json does not declare`);
      }
    }
  }
  return [...problems];
}

/** The files behind every subpath the package's exports map offers. */
function entryFiles() {
  const files = [];
  const walk = (folder) =>
    readdirSync(folder, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory() ? walk(join(folder, item.name)) : [join(folder, item.name)],
    );
  for (const [subpath, target] of Object.entries(MANIFEST.exports)) {
    assert.equal(typeof target, 'string', `exports["${subpath}"] must name 1 file pattern`);
    const star = target.indexOf('*');
    if (star === -1) {
      files.push(join(PACKAGE, target));
      continue;
    }
    const [prefix, suffix] = [target.slice(0, star), target.slice(star + 1)];
    const folder = join(PACKAGE, prefix);
    files.push(...walk(folder).filter((file) => file.endsWith(suffix)));
  }
  return files;
}

test('the package offers subpaths to check', () => {
  assert.ok(entryFiles().length > 0, 'the exports map matched no files, so nothing was checked');
});

test('nothing the package re-exports reaches React Native, Expo, React Navigation or app-only code', () => {
  const problems = entryFiles().flatMap((entry) => importGraphProblems(entry));
  assert.deepEqual(problems, []);
});

test('the walk catches every rule, however deep or type-only the import', () => {
  const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
  const problems = importGraphProblems(join(fixtures, 'entry.ts'), {
    appOnlyFolders: [join(fixtures, 'screens')],
  });
  const rules = [
    /^imports react-native: .*entry\.ts -> .*middle\.ts$/,
    /^reads process\.env, .*middle\.ts$/,
    /^reads __DEV__, .*middle\.ts$/,
    /^reaches alethical\.com's app-only code: .*screens\/Screen\.ts$/,
    /^has a platform-specific twin.*platform\.ts$/,
    /^imports left-pad, which packages\/shared\/package\.json does not declare: .*entry\.ts$/,
    /^reads globalThis\.__DEV__, .*runtimeLookups\.ts$/,
    /^reads window\.process, .*runtimeLookups\.ts$/,
    /^reads global\.__DEV__, .*runtimeLookups\.ts$/,
    /^imports a module named only at run time, import\(name\): .*runtimeLookups\.ts$/,
    /^imports a module named only at run time, require\(`\.\/\$\{name\}`\): .*runtimeLookups\.ts$/,
  ];
  for (const rule of rules) {
    assert.ok(
      problems.some((problem) => rule.test(problem)),
      `no problem matched ${rule}:\n${problems.join('\n')}`,
    );
  }
  assert.equal(problems.length, rules.length, problems.join('\n'));
});
