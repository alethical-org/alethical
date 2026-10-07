import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Keep pathological inputs in a bounded child: an accidentally regressed
// indexed-map loop must fail instead of hanging the security scan itself.
const probe = String.raw`
  const assert = require('node:assert/strict');
  const { SourceMapConsumer, SourceMapGenerator, SourceNode } = require(process.argv[1]);
  const base = () => ({version: 3, sources: ['a.js'], sourcesContent: ['a'], names: [], mappings: 'AAAA'});
  function indexed(line, column, map) {
    if (arguments.length < 2) column = 0;
    if (arguments.length < 3) map = base();
    return { version: 3, sections: [{offset: {line, column}, map}] };
  }
  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, 9007199254740992, '1', null, undefined, {}]) {
    assert.throws(() => new SourceMapConsumer(indexed(value)), Error);
    assert.throws(() => new SourceMapConsumer(indexed(0, value)), Error);
  }
  assert.throws(() => new SourceMapConsumer(indexed(1e7 + 1)), /must not exceed/);
  assert.throws(() => new SourceMapConsumer(indexed(5e6, 0, indexed(5e6, 0, indexed(5e6)))), /nested sections/);
  const atLimit = new SourceMapConsumer(indexed(1e7));
  const node = SourceNode.fromStringWithSourceMap('var x;\n', atLimit);
  assert.equal(node.toString(), 'var x;\n');
  assert.ok(node.children.length < 10);
  const generator = new SourceMapGenerator({file: 'min.js'});
  atLimit.eachMapping(m => generator.addMapping({
    generated: {line: m.generatedLine, column: m.generatedColumn},
    original: {line: m.originalLine, column: m.originalColumn}, source: m.source
  }));
  const generated = generator.toJSON().mappings;
  assert.equal(generated.length, 1e7 + 4);
  assert.equal(generated.slice(-5), ';AAAA');
  let deep = base();
  for (let i = 0; i < 40; i++) deep = indexed(0, 0, deep);
  const consumer = new SourceMapConsumer(deep);
  let inner = consumer;
  for (let i = 0; i < 40; i++) inner = inner._sections[0].consumer;
  let reads = 0;
  const sources = inner.sources;
  Object.defineProperty(inner, 'sources', {get() { reads++; return sources; }});
  assert.deepEqual(consumer.sources, ['a.js']);
  assert.equal(reads, 1);
  const nestedNode = SourceNode.fromStringWithSourceMap('var x;\n', consumer);
  assert.equal(nestedNode.toString(), 'var x;\n');
  const ordinary = new SourceMapConsumer(indexed(3, 4));
  assert.deepEqual(ordinary.originalPositionFor({line: 4, column: 5}), {source: 'a.js', line: 1, column: 0, name: null});
`;

const jsdomRequire = createRequire(require.resolve('jsdom'));
const consumers = [
  ['jsdom CSS parser', createRequire(jsdomRequire.resolve('css-tree'))],
  ['PostCSS', createRequire(require.resolve('postcss'))],
];
for (const [name, consumerRequire] of consumers) {
  const entry = consumerRequire.resolve('source-map-js');
  assert.equal(consumerRequire('source-map-js/package.json').version, '1.2.2');
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '--eval', probe, entry], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, `${name}: ${result.error?.message || result.stderr}`);
}

const cssTree = jsdomRequire('css-tree');
const generatedCss = cssTree.generate(cssTree.parse('a { color: red }', { positions: true }), {
  sourceMap: true,
});
assert.equal(generatedCss.css, 'a{color:red}');
assert.equal(generatedCss.map.toJSON().version, 3);
const postcss = require('postcss');
const css = postcss([]).process('a { color: red }', {
  from: 'input.css',
  to: 'output.css',
  map: { inline: false },
});
assert.match(css.css, /color: red/);
assert.equal(css.map.toJSON().version, 3);

console.log(
  'GHSA-68fv-2mgg-jv7q: published 1.2.2 repair passes indexed-map limits and both CSS consumers',
);
