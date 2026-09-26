import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} };
  modules.set(file, module.exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (specifier) => {
        if (!specifier.startsWith('.')) throw new Error(`Unexpected registry import: ${specifier}`);
        return load(path.resolve(path.dirname(file), `${specifier}.ts`));
      },
    },
    { filename: file },
  );
  return module.exports;
}

const { PUBLISHED_PIECE_INDEX, piecePath } = load(
  path.resolve(here, '../src/lib/researchIndex.ts'),
);
const identities = new Set();
const articles = PUBLISHED_PIECE_INDEX.map((piece) => {
  if (!piece.articleId || identities.has(piece.articleId)) {
    throw new Error(`Published piece ${piece.slug} needs a unique stable articleId`);
  }
  identities.add(piece.articleId);
  return { article_id: piece.articleId, title: piece.title, path: piecePath(piece) };
}).sort((a, b) => a.article_id.localeCompare(b.article_id));
const destination = path.resolve(here, '../../../alethical/data/editorial_articles.json');
mkdirSync(path.dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(articles, null, 2)}\n`);
console.log(`Saved ${articles.length} published editorial identities`);
