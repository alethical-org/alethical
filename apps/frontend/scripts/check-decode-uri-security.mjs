import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/decode-uri-component@0.5.0.patch';
const patchHash = '13e7459eede8a8978ea018e1708a8703f84a0a06b897b607d5da8fa60c38ecee';
const indexHash = '6a86ac891edf15c5efa0841ebb31935e3669d58b98318b57d7b08a4530317cb0';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Exact upstream fad01d65b93bd3f2f0dc32dfd8d57a38b57bc608 backport. The
// 0.5.1 release is younger than the unchanged 7-day package-age guard.
export function verifyDecodeRepairFiles(directory, decoderEntry) {
  assert.equal(sha256(readFileSync(join(directory, patchPath))), patchHash);
  assert.match(
    readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'),
    /^  decode-uri-component@0\.5\.0: patches\/decode-uri-component@0\.5\.0\.patch$/m,
  );
  assert.match(
    readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8'),
    new RegExp(
      `^  decode-uri-component@0\\.5\\.0:\\n    hash: ${patchHash}\\n    path: patches/decode-uri-component@0\\.5\\.0\\.patch\\n`,
      'm',
    ),
  );
  assert.equal(sha256(readFileSync(decoderEntry)), indexHash);
}

const navigationRequire = createRequire(require.resolve('@react-navigation/core'));
const queryStringEntry = navigationRequire.resolve('query-string');
const queryStringRequire = createRequire(queryStringEntry);
const decoderEntry = queryStringRequire.resolve('decode-uri-component');
assert.equal(
  JSON.parse(readFileSync(join(dirname(decoderEntry), 'package.json'), 'utf8')).version,
  '0.5.0',
);
verifyDecodeRepairFiles(root, decoderEntry);

// Run through the actual query-string copy used by React Navigation. Count
// full-input scans on a bounded malformed input rather than relying on a fast
// machine to mask the quadratic algorithm. A timeout also bounds any regression.
const result = spawnSync(
  process.execPath,
  [
    '--input-type=commonjs',
    '--eval',
    `
    const assert = require('node:assert/strict');
    const {createRequire} = require('node:module');
    const qs = require(process.argv[1]);
    const localRequire = createRequire(process.argv[1]);
    const decode = localRequire('decode-uri-component').default;
    for (const [encoded, expected] of [
      ['Saint%20Paul%20%C3%A5%20%F0%9F%98%80', 'Saint Paul å 😀'],
      ['%E0%A4%A', '%E0%A4%A'], ['%GG', '%GG'], ['%25C2%zz', '%C2%zz'],
      ['%25%41%zz', '%A%zz'], ['%41%FE%FF', 'A\\uFFFD\\uFFFD'], ['%C2', '\\uFFFD'],
    ]) assert.equal(decode(encoded), expected);
    assert.deepEqual({...qs.parse('q=Saint+Paul%20%C3%A5%20%F0%9F%98%80&encoded%20key=%2B')},
      {'encoded key': '+', q: 'Saint Paul å 😀'});
    assert.deepEqual({...qs.parse('q=%E0%A4%A&literal=%25&bad=%GG')},
      {bad:'%GG',literal:'%',q:'%E0%A4%A'});
    assert.deepEqual({...qs.parse('q=first&q=second&flag&empty=')},
      {empty:'',flag:null,q:['first','second']});
    assert.equal(qs.stringify({q:'Saint Paul å 😀',symbol:'+'},{sort:false}),
      'q=Saint%20Paul%20%C3%A5%20%F0%9F%98%80&symbol=%2B');
    let payload='';
    for(let i=0;i<4096;i++) payload+='%'+Math.floor(i/256).toString(16).padStart(2,'0')+'%'+(i%256).toString(16).padStart(2,'0')+'x';
    payload+='%zz';
    const replace=String.prototype.replace;let scans=0;
    String.prototype.replace=function(...args){if(String(this).length>=payload.length/2)scans++;return replace.apply(this,args)};
    const start=performance.now(); const decoded=decode(payload);
    String.prototype.replace=replace;
    assert.ok(scans<=2,'decoder rescanned the full input '+scans+' times');
    assert.equal(qs.parse('q='+payload).q,decoded);
    console.log(JSON.stringify({bytes:payload.length,wholeInputScans:scans,ms:performance.now()-start}));
  `,
    queryStringEntry,
  ],
  { encoding: 'utf8', timeout: 5000 },
);
assert.equal(result.status, 0, result.error?.message ?? result.stderr);
console.log(result.stdout.trim());
console.log(
  'GHSA-qr28-fpjm-wq7f: exact upstream single-pass backport verified through React Navigation query-string; valid and malformed query text remains compatible',
);
