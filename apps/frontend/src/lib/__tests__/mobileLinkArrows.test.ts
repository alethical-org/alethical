import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

const legacyTextArrowLimits: Record<string, number> = {
  'components/billDetail/CitationCard.tsx': 1,
  'screens/redesign/LegislatorProfileMobileScreen.tsx': 1,
  // On-screen actions restored to their pre-link-standardization appearance.
  'components/billDetail/FactsRail.tsx': 1, // See dates: section jump.
  'components/billDetail/ActionsTab.tsx': 1, // View votes: section jump.
  'screens/redesign/BillDetailScreen.tsx': 2, // See dates and View votes.
  'screens/redesign/AskAnswerScreen.tsx': 1, // Try again: retry in place.
};

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function visibleTextArrowCount(source: string) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return withoutComments.match(/[→↗]/g)?.length ?? 0;
}

describe('mobile link arrows', () => {
  it('does not put destination-link arrow helpers inside on-screen buttons', () => {
    for (const path of tsxFiles(SRC)) {
      const file = relative(SRC, path);
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.attributes.properties.some(
            (attr) =>
              ts.isJsxAttribute(attr) &&
              ['accessibilityRole', 'role'].includes(attr.name.getText(source)) &&
              attr.initializer &&
              ts.isStringLiteral(attr.initializer) &&
              attr.initializer.text === 'button',
          )
        ) {
          expect
            .soft(node.getText(source), `${file} gave an on-screen button a destination arrow`)
            .not.toMatch(/<(?:GreenLinkArrow|LinkArrowLabel)\b/);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });

  it('blocks new text link arrows while preserving accepted on-screen action arrows', () => {
    for (const path of tsxFiles(SRC)) {
      const file = relative(SRC, path);
      const arrowCount = visibleTextArrowCount(readFileSync(path, 'utf8'));
      expect(arrowCount, `${file} added a phone-dependent text arrow`).toBeLessThanOrEqual(
        legacyTextArrowLimits[file] ?? 0,
      );
    }
  });

  it('blocks local copies of the old green link drawing outside the restored reveal action', () => {
    const oldGreenArrow =
      /d="M5 12 H19 M1[34] [67] L19 12 L1[34] 1[78]"[\s\S]{0,180}stroke="#0f7a45"/;

    for (const path of tsxFiles(SRC)) {
      const file = relative(SRC, path);
      let source = readFileSync(path, 'utf8');
      if (file === 'components/lobbying/LobbyingRecordCards.tsx') {
        source = source.replace(/function RevealArrow\(\) \{[\s\S]*?\n\}/, '');
      }
      expect(source, `${file} drew an old green arrow instead of using LinkArrow`).not.toMatch(
        oldGreenArrow,
      );
    }
  });

  it('keeps vertical alignment inside LinkArrow instead of page-specific arrow nudges', () => {
    for (const path of tsxFiles(SRC)) {
      const file = relative(SRC, path);
      const source = readFileSync(path, 'utf8');
      const tags = source.match(/<LinkArrow\b[\s\S]*?\/>/g) ?? [];

      for (const tag of tags) {
        expect(tag, `${file} moved LinkArrow vertically inside the call`).not.toMatch(
          /\b(?:top|bottom|marginTop|marginBottom|verticalAlign)\s*:|translateY/,
        );
        for (const match of tag.matchAll(/(?:styles|m)\.(\w+)/g)) {
          const styleName = match[1];
          const body = source.match(new RegExp(`${styleName}:\\s*\\{([^}]*)\\}`))?.[1] ?? '';
          expect(body, `${file} moved LinkArrow vertically in styles.${styleName}`).not.toMatch(
            /\b(?:top|bottom|marginTop|marginBottom|verticalAlign)\s*:|translateY/,
          );
        }
      }
    }
  });
});
