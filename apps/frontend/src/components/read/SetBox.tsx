import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronDown } from '../icons';
import { articleHrefWithReturn } from '../../lib/articleReturn';
import { TOPICS, topicPath, type TopicSlug } from '../../lib/researchIndex';
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
 * destination from the box itself, while its group page has a separate link.
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

/** One published piece inside a set: its reading time above its title. */
function SetRow({
  piece,
  isLast,
  isMobile,
  onOpen,
  sourceHref,
}: {
  piece: ResearchPiece;
  isLast: boolean;
  isMobile: boolean;
  onOpen: () => void;
  sourceHref: string;
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
        {...({ 'data-entry-link': piece.slug } as object)}
        {...linkProps(articleHrefWithReturn(routePath.piece(piece), sourceHref), onOpen)}
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
        <Text style={[styles.rowTime, isMobile && styles.rowTimeMobile]}>
          {pieceRowTime(piece)}
        </Text>
        <Text
          style={[
            styles.rowTitle,
            isMobile && styles.rowTitleMobile,
            hovered && styles.rowTitleHover,
          ]}
        >
          {piece.title}
        </Text>
      </Pressable>
    </View>
  );
}

export function SetBox({
  group,
  isMobile,
  onOpenPiece,
  sourceHref = '/read',
  onTopic,
  onOpenPage,
  showPageLink = false,
  initiallyOpen = true,
  headingLevel = 3,
}: {
  group: PieceSetGroup;
  isMobile: boolean;
  onOpenPiece: (piece: ResearchPiece) => void;
  sourceHref?: string;
  onTopic?: (topic: TopicSlug) => void;
  onOpenPage?: () => void;
  showPageLink?: boolean;
  initiallyOpen?: boolean;
  headingLevel?: 1 | 2 | 3;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = `set-${group.slug}-list`;
  const sharedTopics =
    group.pieces[0]?.topics?.filter((topic) =>
      group.pieces.every((piece) => piece.topics?.includes(topic)),
    ) ?? [];

  return (
    <View style={[styles.box, isMobile && styles.boxMobile]}>
      <style>{`[data-set-topic-link]:focus-visible,[data-set-page-link]:focus-visible{outline:2px solid #7c5cff;outline-offset:2px;border-radius:8px}@media(hover:hover){[data-set-topic-link]:hover>*{background:#f1f3f2;border-color:rgba(17,21,15,.3)}[data-set-page-link]:hover [data-set-page-words]{color:#11832b;text-decoration:underline}}[data-set-topic-link]:active>*{background:#e6e9e7}`}</style>
      {/* The count comes before the set name, matching the cards and rows. */}
      <Text style={[styles.meta, isMobile && styles.metaMobile]}>{setMetaLine(group)}</Text>
      {/* The button sits INSIDE the heading, never the other way round: a heading
          nested inside interactive content is not reliably exposed as a heading,
          and this is the only order that survives heading navigation. A reader
          jumping by headings lands on the set's name, and that same element is
          the control. */}
      <View accessibilityRole="header" aria-level={headingLevel}>
        <Pressable
          accessibilityRole="button"
          aria-expanded={open}
          aria-controls={listId}
          onPress={() => setOpen((wasOpen) => !wasOpen)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={[styles.summary, isMobile && styles.summaryMobile]}
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

      {sharedTopics.length > 0 && (
        <View style={styles.sharedTopics}>
          {sharedTopics.map((slug) => (
            <Pressable
              key={slug}
              {...({ 'data-set-topic-link': '' } as object)}
              {...linkProps(topicPath(slug), () => onTopic?.(slug))}
              style={styles.topicTarget}
            >
              <Text style={styles.topicChip}>
                {TOPICS.find((topic) => topic.slug === slug)?.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

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
                sourceHref={
                  sourceHref === '/read'
                    ? '/read'
                    : `${sourceHref}${sourceHref.includes('?') ? '&' : '?'}post=${encodeURIComponent(piece.slug)}`
                }
                onOpen={() => onOpenPiece(piece)}
              />
            ))}
          </View>
        ) : null}
      </View>
      {showPageLink && (
        <Pressable
          {...({ 'data-set-page-link': '' } as object)}
          {...linkProps(`/read/sets/${group.slug}`, () => onOpenPage?.())}
          accessibilityLabel={`Open the ${group.name} group page`}
          style={styles.pageLink}
        >
          <Text style={styles.pageLinkText}>
            <Text {...({ 'data-set-page-words': '' } as object)}>Open group page</Text>
            <Text aria-hidden> →</Text>
          </Text>
        </Pressable>
      )}
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
  sharedTopics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  topicTarget: { minHeight: 44, justifyContent: 'center' },
  topicChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#11150f',
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.semibold,
  },
  pageLink: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  pageLinkText: {
    color: '#0f7a45',
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.semibold,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    width: '100%',
    minHeight: CLEAR_SEARCH_TARGET_SIZE,
    marginTop: 11,
  },
  summaryMobile: { marginTop: 8 },
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
    color: '#656c66',
    fontFamily: t.typography.ui,
    fontSize: 11.5,
    lineHeight: 17.25,
    fontWeight: t.fontWeights.heavy,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.115,
  },
  metaMobile: { fontSize: 10.5, lineHeight: 15.75, letterSpacing: 0.105 },
  list: { marginTop: 22, borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  listMobile: { marginTop: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: t.colors.alpha.ink07 },
  row: {
    paddingVertical: 22,
    paddingHorizontal: 14,
    marginHorizontal: -14,
    borderRadius: 10,
  },
  rowMobile: {
    paddingVertical: 16,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  rowHover: { backgroundColor: t.colors.surfaces.s200 },
  rowTitle: {
    marginTop: 11,
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.2,
  },
  rowTitleMobile: { marginTop: 9, fontSize: 18, lineHeight: 24.3, letterSpacing: -0.18 },
  rowTitleHover: { color: t.colors.text.greenOnLight },
  rowTime: {
    color: '#656c66',
    fontFamily: t.typography.ui,
    fontSize: 11.5,
    lineHeight: 17.25,
    fontWeight: t.fontWeights.heavy,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.115,
  },
  rowTimeMobile: { fontSize: 10.5, lineHeight: 15.75, letterSpacing: 0.105 },
  // Read out, never drawn: the app's own visually-hidden treatment, which keeps
  // the words in the accessible name while taking them out of the layout.
  rowKindForScreenReaders: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
