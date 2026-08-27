import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronDown } from '../icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { CLEAR_SEARCH_TARGET_SIZE } from '../../lib/legislatorSearch';
import {
  pieceRowTime,
  setMetaLine,
  type PieceSetGroup,
  type ResearchPiece,
} from '../../lib/research';
import { linkProps, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

/**
 * One set of pieces written to be read together, on the /read page: the set's
 * name, how many pieces and how long they run, and a row per published piece
 * (Design's `/read` handoff and its `RULE Set box`, 27 Aug 2026).
 *
 * **The box is not a link and does not lift on hover.** Only its summary row is a
 * control, and each row inside is its own link. Lifting the box would promise a
 * destination it does not have: `/read/sets/{slug}` is not built.
 *
 * **It lists published pieces only** — never a title a reader cannot open, and
 * never a count of how many the set is eventually meant to hold
 * (`docs/architecture/published-writing-decisions.md` §2.3). A row carries a title
 * and a time and nothing else: no date, no kind word, and no position in the set,
 * which reaches no reader on any surface (§2.12).
 *
 * **A box shows from the set's first published piece** (§2.5), drawn whole at 1
 * row. The repetition between the meta line and a single row is the price of
 * saying the set is live and growing, and Eugene ruled it worth paying.
 *
 * There is no fold-away element to inherit. React Native's web renderer produces
 * its own elements, and the app has no disclosure or accordion component, so the
 * control is hand-built: nothing here reaches for a browser default.
 */

const isWeb = Platform.OS === 'web';

/**
 * The other half of the app's visually-hidden treatment. `overflow: hidden` on a
 * 1px box is what every browser but Safari honours; the clip is what makes Safari
 * agree, and it is web-only because React Native has no such property.
 */
const webClip = isWeb ? ({ clipPath: 'inset(50%)' } as object) : null;

/** Web-only CSS transition, so the chevron turns rather than jumping. */

function foldTransition(reducedMotion: boolean) {
  if (!isWeb || reducedMotion) return null;
  return { transitionProperty: 'transform', transitionDuration: '0.16s' } as object;
}

function washTransition(reducedMotion: boolean) {
  if (!isWeb || reducedMotion) return null;
  return { transitionProperty: 'background-color, color', transitionDuration: '0.14s' } as object;
}

/** One published piece inside a set: its title, and its reading time in a right-hand column. */
function SetRow({
  piece,
  isLast,
  isMobile,
  onOpen,
}: {
  piece: ResearchPiece;
  isLast: boolean;
  isMobile: boolean;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    // The rule belongs to the row's container rather than the row, so the hover
    // tint bleeds past the box's padding without carrying the line with it.
    // `listitem` is not in React Native's own role list, so it is passed as a web
    // role: the renderer turns it into a real `<li>` inside the `<ul>` above.
    <View {...({ role: 'listitem' } as object)} style={!isLast && styles.rowDivider}>
      <Pressable
        {...linkProps(routePath.piece(piece), onOpen)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.row,
          isMobile && styles.rowMobile,
          hovered && styles.rowHover,
          washTransition(reducedMotion),
        ]}
      >
        {/* A row inside a set box prints no kind word: the meta line above says it
            once for the whole set. A screen reader still hears it, because a row
            announced on its own has no meta line beside it. */}
        <Text style={[styles.rowKindForScreenReaders, webClip]}>Guide: </Text>
        <Text
          style={[
            styles.rowTitle,
            isMobile && styles.rowTitleMobile,
            hovered && styles.rowTitleHover,
          ]}
        >
          {piece.title}
        </Text>
        <Text style={[styles.rowTime, isMobile && styles.rowTimeMobile]}>
          {pieceRowTime(piece)}
        </Text>
      </Pressable>
    </View>
  );
}

export function SetBox({
  group,
  isMobile,
  onOpenPiece,
}: {
  group: PieceSetGroup;
  isMobile: boolean;
  onOpenPiece: (piece: ResearchPiece) => void;
}) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = `set-${group.slug}-list`;

  return (
    <View style={[styles.box, isMobile && styles.boxMobile]}>
      {/* The button sits INSIDE the heading, never the other way round: a heading
          nested inside interactive content is not reliably exposed as a heading,
          and this is the only order that survives heading navigation. A reader
          jumping by headings lands on the set's name, and that same element is
          the control. */}
      <View accessibilityRole="header" aria-level={3}>
        <Pressable
          accessibilityRole="button"
          aria-expanded={open}
          aria-controls={listId}
          onPress={() => setOpen((wasOpen) => !wasOpen)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.summary}
        >
          {/* The set's name is a heading, not a destination, so it never changes
              colour. Everything this control does visually happens in the
              chevron's circle. */}
          <Text style={[styles.setName, isMobile && styles.setNameMobile]}>{group.name}</Text>
          <View style={styles.chevronTarget}>
            {/* An ink wash rather than an opaque fill: a wash is right on the
                box's fill, on the page's fill, and on any surface a set box is
                ever dropped onto. An opaque grey is right on exactly one. */}
            <View
              style={[
                styles.chevronCircle,
                hovered && styles.chevronCircleHover,
                pressed && styles.chevronCirclePressed,
                washTransition(reducedMotion),
              ]}
            >
              <View aria-hidden style={[open && styles.chevronOpen, foldTransition(reducedMotion)]}>
                <ChevronDown
                  size={isMobile ? 16 : 18}
                  strokeWidth={2.2}
                  color={t.colors.text.primary}
                />
              </View>
            </View>
          </View>
        </Pressable>
      </View>

      {/* Closing hides the rows and the rule above them, never the meta line: the
          count and the total are how a reader decides whether to open it. */}
      <Text style={[styles.meta, isMobile && styles.metaMobile]}>{setMetaLine(group)}</Text>

      {/* The wrapper carries the id whether the box is open or shut, so
          `aria-controls` never points at an element that is not there. Rows appear
          and disappear instantly, whatever the motion setting: animating the
          height would drag every card below it, which on a list page moves the
          reader's next destination under their thumb. */}
      <View nativeID={listId}>
        {open ? (
          <View accessibilityRole="list" style={[styles.list, isMobile && styles.listMobile]}>
            {group.pieces.map((piece, index) => (
              <SetRow
                key={piece.slug}
                piece={piece}
                isLast={index === group.pieces.length - 1}
                isMobile={isMobile}
                onOpen={() => onOpenPiece(piece)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fill, border and radius are the listing card's; the hover lift is not,
  // because this box is not a link.
  box: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 16,
    paddingVertical: 30,
    paddingHorizontal: 36,
  },
  boxMobile: { paddingTop: 22, paddingBottom: 24, paddingHorizontal: 20 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    width: '100%',
    minHeight: CLEAR_SEARCH_TARGET_SIZE,
  },
  setName: {
    flexShrink: 1,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.8,
  },
  setNameMobile: { fontSize: 25, lineHeight: 29, letterSpacing: -0.63 },
  // A 30px circle centred in a 44px target leaves 7px of slack, so -7 is what
  // puts the circle's right edge on the same line the rows below it end at.
  chevronTarget: {
    flexGrow: 0,
    flexShrink: 0,
    width: CLEAR_SEARCH_TARGET_SIZE,
    height: CLEAR_SEARCH_TARGET_SIZE,
    marginRight: -7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronCircleHover: { backgroundColor: t.colors.alpha.ink10 },
  chevronCirclePressed: { backgroundColor: t.colors.alpha.ink16 },
  // Closed points down, the direction the nav's chevron uses for "there is more
  // below". Open is the same glyph turned over, rather than a second glyph.
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  meta: {
    marginTop: 11,
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 12.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
  },
  metaMobile: { marginTop: 9, fontSize: 11.5, letterSpacing: 0.92 },
  list: { marginTop: 22, borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  listMobile: { marginTop: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: t.colors.alpha.ink07 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 32,
    paddingVertical: 20,
    paddingHorizontal: 14,
    marginHorizontal: -14,
    borderRadius: 10,
  },
  rowMobile: {
    gap: 14,
    minHeight: CLEAR_SEARCH_TARGET_SIZE,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  rowHover: { backgroundColor: t.colors.surfaces.s200 },
  rowTitle: {
    flexShrink: 1,
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: t.fontWeights.semibold,
  },
  rowTitleMobile: { fontSize: 18, lineHeight: 24 },
  rowTitleHover: { color: t.colors.text.greenOnLight },
  rowTime: {
    flexGrow: 0,
    flexShrink: 0,
    color: t.colors.text.faint,
    fontFamily: t.typography.mono,
    fontSize: 14,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.56,
  },
  rowTimeMobile: { fontSize: 13, letterSpacing: 0.52 },
  // Read out, never drawn: the app's own visually-hidden treatment, which keeps
  // the words in the accessible name while taking them out of the layout.
  rowKindForScreenReaders: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
