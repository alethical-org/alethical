import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SET_BOX = readFileSync(join(HERE, '..', 'SetBox.tsx'), 'utf8');
const READING = readFileSync(join(HERE, '../../..', 'screens/redesign/ReadScreen.tsx'), 'utf8');

/**
 * The fold control has no precedent in this app: React Native's web renderer
 * makes its own elements, so there is no fold-away element to inherit and no
 * accordion component anywhere. Every part of it is hand-built, which means every
 * part of it can be dropped without anything visible breaking.
 *
 * These are source-text checks on purpose. A missing `aria-controls` or a heading
 * nested the wrong way round looks identical on screen and is only visible by
 * reading the accessibility tree in a browser, so nothing else would catch it.
 */
describe('the set box fold control', () => {
  it('puts the button inside the heading, never the heading inside the button', () => {
    // A heading nested inside interactive content is not reliably exposed as a
    // heading, so this is the only order that survives heading navigation.
    const heading = SET_BOX.indexOf('accessibilityRole="header"');
    const button = SET_BOX.indexOf('accessibilityRole="button"');
    expect(heading).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(heading);
    expect(SET_BOX).toContain('aria-level={3}');
  });

  it('carries both halves of the disclosure, not only the visible one', () => {
    // `aria-controls` is the half most likely to be dropped: it is used twice in
    // the whole app, and nothing looks wrong without it.
    expect(SET_BOX).toContain('aria-expanded={open}');
    expect(SET_BOX).toContain('aria-controls={listId}');
    expect(SET_BOX).toContain('nativeID={listId}');
  });

  it('keeps the list element present while the box is shut', () => {
    // `aria-controls` pointing at an element that is not in the document is a
    // broken reference, so the wrapper stays and only the rows come and go.
    const wrapper = SET_BOX.indexOf('<View nativeID={listId}>');
    const conditional = SET_BOX.indexOf('{open ? (');
    expect(wrapper).toBeGreaterThan(-1);
    expect(conditional).toBeGreaterThan(wrapper);
  });

  it('hides the chevron from a screen reader and reuses the app’s own icon', () => {
    expect(SET_BOX).toContain('aria-hidden');
    expect(SET_BOX).toContain('<ChevronDown');
    expect(SET_BOX).toContain('strokeWidth={2.2}');
    // Round caps and joins come from the shared icon factory, so they are not
    // set here; `absoluteStrokeWidth` would undo the deliberate extra weight.
    expect(SET_BOX).not.toContain('absoluteStrokeWidth');
  });

  it('reuses the app’s 44px target constant rather than retyping the number', () => {
    expect(SET_BOX).toContain(
      "import { CLEAR_SEARCH_TARGET_SIZE } from '../../lib/legislatorSearch'",
    );
    expect(SET_BOX).toContain('minHeight: CLEAR_SEARCH_TARGET_SIZE');
    expect(SET_BOX).toContain('width: CLEAR_SEARCH_TARGET_SIZE');
  });

  it('washes the chevron’s circle in ink rather than filling it with grey', () => {
    // A wash is right on the box's fill, the page's fill, and any surface a set
    // box is ever dropped onto. An opaque grey is right on exactly one of them.
    expect(SET_BOX).toContain('t.colors.alpha.ink10');
    expect(SET_BOX).toContain('t.colors.alpha.ink16');
    // The 30px circle centred in the 44px target leaves 7px, which is what puts
    // its right edge on the line the rows end at.
    expect(SET_BOX).toContain('marginRight: -7');
  });

  it('turns only the chevron, and never the box’s height', () => {
    expect(SET_BOX).toContain("transform: [{ rotate: '180deg' }]");
    expect(SET_BOX).toContain("transitionProperty: 'transform'");
    expect(SET_BOX).toContain("transitionDuration: '0.16s'");
    // Growing the box would drag every card under it, moving the reader's next
    // destination under their thumb.
    expect(SET_BOX).not.toContain('LayoutAnimation');
    expect(SET_BOX).not.toContain('Animated');
  });

  it('leaves the set’s name a heading rather than a destination', () => {
    // Everything this control does visually happens in the chevron's circle.
    expect(SET_BOX).not.toContain('setNameHover');
    expect(SET_BOX).toContain('styles.setName');
  });

  it('makes each row its own link and the box itself none', () => {
    expect(SET_BOX).toContain('linkProps(routePath.piece(piece), onOpen)');
    // The box has no hover lift, because it has no destination to promise.
    expect(SET_BOX).not.toContain('boxHover');
    expect(SET_BOX).toContain('rowHover');
  });

  it('says the kind once for the set and not again on every row', () => {
    expect(SET_BOX).toContain('setMetaLine(group)');
    // Read out, never drawn: a row announced on its own has no meta line beside it.
    expect(SET_BOX).toContain('rowKindForScreenReaders');
    expect(SET_BOX).toContain('>Guide: </Text>');
  });
});

describe('the /read page’s own structure', () => {
  it('shows no title and still names the page for a reader who cannot see it', () => {
    expect(READING).toContain('aria-level={1}');
    expect(READING).toContain('styles.hiddenHeading');
    expect(READING).toContain('{READ_PAGE_NAME}');
    // The old visible title is gone, and the name is read off the bar's label
    // rather than typed a second time.
    expect(READING).not.toContain('styles.heading,');
  });

  it('gives every card the kind word a screen reader needs and no ink word', () => {
    expect(READING).toContain('pieceKindLabel(piece)');
    expect(READING).toContain('cardKindForScreenReaders');
    // The heading above supplies it in ink, so the card prints nothing.
    expect(READING).not.toContain('pieceCardCta');
  });

  it('draws the set boxes above the loose cards, in source order', () => {
    const sets = READING.indexOf('group.sets.map');
    const cards = READING.indexOf('group.pieces.map');
    expect(sets).toBeGreaterThan(-1);
    expect(cards).toBeGreaterThan(sets);
  });

  it('renders no kind heading over nothing', () => {
    expect(READING).toContain(
      '.filter((group) => group.sets.length > 0 || group.pieces.length > 0)',
    );
  });

  it('keeps the spacing on the slot rather than on the group', () => {
    // So an empty group swaps the rhythm with the position instead of taking it
    // with it.
    expect(READING).toContain('groupHeadingFirst');
    expect(READING).toContain('groupHeadingLater');
    expect(READING).toContain('index === 0');
  });

  it('does not build a set’s own page or its overflow link yet', () => {
    // Both are Design's, at 6 published pieces; `/read/sets/{slug}` is unbuilt,
    // and we link only to what exists.
    // The words may appear in a comment saying it is not built; what must not
    // appear is a string the page would draw.
    for (const source of [READING, SET_BOX]) {
      expect(source).not.toContain('`All of ');
      expect(source).not.toMatch(/'All of /);
    }
    expect(SET_BOX).not.toContain('routePath.set');
  });
});
