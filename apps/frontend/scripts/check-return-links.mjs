import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// This source guard catches known structural regressions. Rendered navigation tests
// still establish whether a label, address and activation describe the same page.
const genericReturn = /^(?:go\s+back|back|return|back\s+to)$/i;
const labelKeys = new Set([
  'label',
  'backLabel',
  'returnLabel',
  'accessibilityLabel',
  'aria-label',
]);
const productionExtension = /\.(?:tsx?|jsx?|mjs)$/;
const skippedDirectories = new Set([
  '__tests__',
  '__fixtures__',
  'node_modules',
  'graphify-out',
  '.claude',
  '.git',
  'dist',
]);

function normalize(value) {
  return value
    .replace(/(?:&(?:lt|gt|nbsp|larr|lsaquo);|&#(?:8592|8249);)/g, ' ')
    .replace(/[←‹<]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]$/, '');
}

function literalValue(node) {
  if (!node) return undefined;
  if (ts.isJsxExpression(node)) return literalValue(node.expression);
  if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  return undefined;
}

function attributeName(attribute) {
  return ts.isJsxAttribute(attribute) ? attribute.name.getText() : '';
}

// The sign-in header's Back changes a dialog step, with its specific action named
// for assistive readers. No page-return exception or file-wide suppression exists.
function isSignInStep(node, filename) {
  if (!filename.replaceAll('\\', '/').endsWith('src/components/auth/SignInContainer.tsx'))
    return false;
  let parent = node.parent;
  while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
  while (parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'Pressable') {
      const label = parent.openingElement.attributes.properties.find(
        (item) => attributeName(item) === 'accessibilityLabel',
      );
      return label?.initializer?.getText() === '{displayedFrame.backAction.label}';
    }
    parent = parent.parent;
  }
  return false;
}

export function checkReturnLinkSource(source, filename = 'src/example.tsx') {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const goBackNames = new Set(['GoBackLink']);
  const add = (node, message) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    if (!findings.some((item) => item.line === line && item.message === message))
      findings.push({ file: filename, line, message });
  };
  for (const statement of file.statements) {
    const bindings = ts.isImportDeclaration(statement) && statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === 'GoBackLink') goBackNames.add(item.name.text);
      }
    }
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(file);
      if (goBackNames.has(name) || name.endsWith('.GoBackLink')) {
        const destination = node.attributes.properties.find(
          (item) => attributeName(item) === 'destinationName',
        );
        if (
          !destination?.initializer ||
          !destination.initializer.getText(file).trim() ||
          (ts.isJsxExpression(destination.initializer) && !destination.initializer.expression) ||
          (literalValue(destination.initializer) !== undefined &&
            (!normalize(literalValue(destination.initializer)) ||
              genericReturn.test(normalize(literalValue(destination.initializer)))))
        ) {
          add(node, 'Page-return control must supply a nonempty, specific destinationName');
        }
      }
    }
    if (
      ts.isJsxElement(node) &&
      ['a', 'Link', 'Pressable', 'button'].includes(node.openingElement.tagName.getText(file))
    ) {
      const children = node.children.filter((child) => !ts.isJsxText(child) || child.text.trim());
      const onlyReturnIcon =
        children.length === 1 &&
        ts.isJsxSelfClosingElement(children[0]) &&
        ['BackIcon', 'ChevronLeft', 'ArrowLeft'].includes(children[0].tagName.getText(file));
      const labelled = node.openingElement.attributes.properties.some(
        (item) =>
          ['accessibilityLabel', 'aria-label', 'aria-labelledby'].includes(attributeName(item)) &&
          item.initializer,
      );
      if (onlyReturnIcon && !labelled)
        add(node, 'Arrow-only return control must have a destination name');
    }
    if (
      ts.isStringLiteralLike(node) &&
      genericReturn.test(normalize(node.text)) &&
      !isSignInStep(node, filename)
    ) {
      let value = node;
      let ancestor = value.parent;
      while (ancestor) {
        if (
          (ts.isJsxAttribute(ancestor) && labelKeys.has(attributeName(ancestor))) ||
          (ts.isPropertyAssignment(ancestor) &&
            labelKeys.has(ancestor.name.getText(file).replace(/^['"]|['"]$/g, ''))) ||
          (ts.isJsxExpression(ancestor) && ancestor.parent && ts.isJsxElement(ancestor.parent))
        ) {
          add(node, 'Generic return label must name the actual destination');
          break;
        }
        // A literal in a condition, argument or style is not rendered wording.
        if (
          !ts.isParenthesizedExpression(ancestor) &&
          !ts.isJsxExpression(ancestor) &&
          !(ts.isConditionalExpression(ancestor) && ancestor.condition !== value)
        )
          break;
        value = ancestor;
        ancestor = ancestor.parent;
      }
    }
    if (
      ts.isJsxText(node) &&
      genericReturn.test(normalize(node.text)) &&
      !isSignInStep(node, filename)
    ) {
      add(node, 'Generic page-return words must name the actual destination');
    }
    if (ts.isJsxAttribute(node) && labelKeys.has(attributeName(node))) {
      const value = literalValue(node.initializer);
      if (value !== undefined && genericReturn.test(normalize(value))) {
        add(node, 'Generic return label must name the actual destination');
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      labelKeys.has(node.name.getText(file).replace(/^['"]|['"]$/g, ''))
    ) {
      const value = literalValue(node.initializer);
      if (value !== undefined && genericReturn.test(normalize(value))) {
        add(node, 'Generic return label must name the actual destination');
      }
    }
    // Snapshot builders use strings/templates rather than JSX. Look at rendered
    // anchors and accessibility labels, not prose quotations or source comments.
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const value = ts.isTemplateExpression(node) ? node.getText(file) : node.text;
      for (const match of value.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
        const text = normalize(match[3].replace(/<[^>]*>/g, ' '));
        const label = /(?:aria-label|accessibilityLabel)\s*=\s*['"]([^'"]*)['"]/i.exec(match[2]);
        if (genericReturn.test(text) || (label && genericReturn.test(normalize(label[1])))) {
          add(node, 'Rendered return markup must name the actual destination');
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !skippedDirectories.has(entry.name))
      files.push(...(await sourceFiles(target)));
    if (
      entry.isFile() &&
      productionExtension.test(entry.name) &&
      !/\.(?:test|spec)\./.test(entry.name)
    )
      files.push(target);
  }
  return files;
}

export async function scanReturnLinks(frontendRoot) {
  const files = await sourceFiles(path.join(frontendRoot, 'src'));
  const apiRoot = path.resolve(frontendRoot, '../../api');
  try {
    files.push(...(await sourceFiles(apiRoot)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const findings = [];
  for (const filename of files.sort()) {
    findings.push(
      ...checkReturnLinkSource(
        await readFile(filename, 'utf8'),
        path.relative(frontendRoot, filename),
      ),
    );
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
  const findings = await scanReturnLinks(frontendRoot);
  for (const item of findings) process.stderr.write(`${item.file}:${item.line}: ${item.message}\n`);
  if (findings.length) process.exitCode = 1;
  else
    process.stdout.write(
      'Page-return source guard passed; rendered destination checks remain required.\n',
    );
}
