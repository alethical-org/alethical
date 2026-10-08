/** Blog-only wording loads with blog screens or the server, not app startup. */
import { IA } from '../navigation/ia';

/**
 * The /blog page's own fixed wording, in one place because 3 surfaces draw
 * it: the screen, its search description in lib/staticPageMetadata.ts, and the text
 * served in the first response before any JavaScript runs
 * (lib/pageSnapshot.ts). A second copy is how a served page and a rendered page
 * start disagreeing, which is worse than either one being wrong alone.
 */

/**
 * The page's own name, taken from the label the top bar already draws for it
 * rather than typed again here.
 *
 * The page shows no visible title: the bar and the address both say the word
 * already, and a third visible instance is what the naming rule forbids (Design,
 * 27 Aug 2026). So this is the name a screen reader reads off the visually
 * hidden `h1` and the name the browser tab carries, and nothing draws it in ink.
 *
 * Read off the bar's own item because that is Design's whole reason for hiding
 * the title: 2 copies of the word could disagree, and this one cannot.
 */
export const READ_PAGE_NAME = IA.find((item) => item.id === 'read')?.label ?? 'Blog';

/**
 * The page's descriptive title, for the 2 places its name has to survive out of
 * context: the back link at the top of a piece, and the share card. Neither has
 * the bar or the address beside it to supply the subject, so neither can use
 * `READ_PAGE_NAME`, because "Blog" alone tells a person nothing about what they
 * would be opening.
 */
export const READ_PAGE_HEADING = 'Research, guides and events';

/**
 * The note under the hidden title. A note rather than a heading, in regular
 * weight and grey, because the bold heads on this page are the kind sections and
 * a reader should see the shape of what we publish before reading a sentence
 * about it (Design, 27 Aug 2026).
 *
 * No terminal period on this line or on the 2 empty-state lines
 * (`READ_PAGE_EMPTY_TITLE` and `READ_PAGE_EMPTY_BODY` in `lib/research.ts`): a
 * period says another sentence is coming, so on a line with nothing after it the
 * eye waits for something that never arrives (Eugene, 2 Sep 2026). A piece's own
 * standfirst, drawn on its card, keeps the period its author wrote.
 */
export const READ_PAGE_INTRO =
  'Research, guides and events that help you understand Minnesota government';
