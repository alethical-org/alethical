import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkReturnLinkSource, scanReturnLinks } from './check-return-links.mjs';

const findings = (source, filename) => checkReturnLinkSource(source, filename);

test('requires destinationName on multiline, aliased and namespaced shared controls', () => {
  for (const source of [
    '<GoBackLink href="/bills" onPress={openBills} />',
    '<GoBackLink\n {...returnProps}\n/>',
    'import { GoBackLink as ReturnLink } from "./GoBackLink"; <ReturnLink href="/bills" />',
    '<Controls.GoBackLink href="/bills" destinationName="" />',
    '<GoBackLink destinationName={"  "} />',
    '<GoBackLink destinationName />',
    '<GoBackLink destinationName={ } />',
    '<GoBackLink destinationName="Go back" />',
  ])
    assert.equal(findings(source).length, 1, source);
  for (const source of [
    '<GoBackLink href="/bills" destinationName="Search bills" />',
    '<GoBackLink href={returnTarget.href} destinationName={returnTarget.name} />',
  ])
    assert.deepEqual(findings(source), []);
});

test('rejects generic visible, spoken and snapshot labels', () => {
  for (const source of [
    '<Text>Go back</Text>',
    '<Text> Back </Text>',
    '<Text>{"Go back"}</Text>',
    '<Text>{ready ? "Go back" : "Back"}</Text>',
    '<a><BackIcon /></a>',
    '<Pressable><ChevronLeft /></Pressable>',
    '<Pressable accessibilityLabel="Go back" />',
    '<a aria-label={"Back"} />',
    'const snapshot = { backLink: { label: "Go back", href: "/candidates" } };',
    'const label = { returnLabel: "Return" };',
    'const html = `<a href="/bills"><span>‹</span> Go back</a>`;',
    'const html = `<button aria-label="Go back"><svg></svg></button>`;',
  ])
    assert.ok(findings(source).length, source);
});

test('does not scan comments, quoted prose, forward links or action-specific workflows', () => {
  const source = `// A historical Go back label
    const article = "The reader can go back to the official source";
    const quote = "Go back";
    <Text>{direction === 'back' ? <Icon /> : <Label />}</Text>;
    <Text>Back to Search bills</Text>;
    <Text>All guides</Text>;
    <button aria-label="Previous page">Previous</button>;
    <button>Cancel</button>;
    <button>Close</button>;
    <button>Back to sign-in choices</button>`;
  assert.deepEqual(findings(source), []);
  assert.deepEqual(findings('<a aria-label="Back to Blog"><BackIcon /></a>'), []);
});

test('workflow exception is confined to the actual sign-in step control', () => {
  const workflow =
    '<Pressable accessibilityLabel={displayedFrame.backAction.label}><Text>Back</Text></Pressable>';
  const filename = 'src/components/auth/SignInContainer.tsx';
  assert.deepEqual(findings(workflow, filename), []);
  assert.ok(findings(workflow, 'src/screens/Page.tsx').length);
  assert.ok(
    findings('<Pressable accessibilityLabel="Go back"><Text>Back</Text></Pressable>', filename)
      .length,
  );
  assert.ok(findings('<GoBackLink href="/bills" /><Text>Go back</Text>', filename).length);
});

test('scanner includes first-response API and source while ignoring tests, dependencies and symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alethical-returns-'));
  const frontend = path.join(root, 'apps/frontend');
  try {
    for (const folder of [
      'src/screens',
      'src/__tests__',
      'src/node_modules',
      'src/graphify-out',
      'src/.claude/worktrees',
      '../../api',
    ]) {
      await mkdir(path.resolve(frontend, folder), { recursive: true });
    }
    await writeFile(path.join(frontend, 'src/screens/Page.tsx'), '<GoBackLink href="/bills" />');
    await writeFile(
      path.join(frontend, '../../api/page.ts'),
      'const html = `<a href="/">Go back</a>`;',
    );
    for (const file of [
      'src/__tests__/Page.tsx',
      'src/screens/Page.test.tsx',
      'src/node_modules/Page.tsx',
      'src/graphify-out/Page.tsx',
      'src/.claude/worktrees/Page.tsx',
    ]) {
      await writeFile(path.join(frontend, file), '<Text>Go back</Text>');
    }
    await symlink(path.join(frontend, '../../api'), path.join(frontend, 'src/other-checkout'));
    assert.deepEqual((await scanReturnLinks(frontend)).map((item) => item.file).sort(), [
      '../../api/page.ts',
      'src/screens/Page.tsx',
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});
