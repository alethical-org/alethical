/**
 * Real anchors for in-app navigation.
 *
 * A React Native `Pressable` renders as a `<div>` on web, so a card or nav row
 * that navigates by calling `navigation.navigate(...)` has no URL in the markup:
 * right-click has no "Open link in new tab", ⌘/Ctrl-click and middle-click do
 * nothing, and the status bar shows no destination. Every in-app destination is
 * already URL-addressable (grounded-answers.md rule 5, "Anything linked to must
 * be URL-addressable"), so the URL just has to reach the DOM.
 *
 * `linkProps(href, onPress)` supplies it. On web react-native-web renders any
 * View/Text/Pressable carrying an `href` as an `<a href>`, which is what gives
 * the browser its native link behaviour. A plain left-click is still handled
 * in-app (preventDefault + navigate) so navigation stays a client-side
 * transition with no full page reload; every modified click is left to the
 * browser so it opens a new tab or window exactly as it would on any site.
 *
 * `routePath` builds the href from the same route → path switch the address bar
 * uses (`pathForRoute` in navigation/webRoutes.ts), so a link's URL and the URL
 * the router lands on after navigating cannot drift apart.
 */
import { Platform, type GestureResponderEvent } from 'react-native';

import type { RootStackParamList } from './types';
import { pathForRoute } from './webRoutes';

const isWeb = Platform.OS === 'web';

/**
 * Paths for the destinations screens link to. Thin wrappers over `pathForRoute`
 * so a call site names the route and its params rather than hand-writing a URL
 * template that can fall out of step with the router.
 */
export const routePath = {
  home: () => pathForRoute({ name: 'Home' }),
  ask: (params?: RootStackParamList['Ask']) => pathForRoute({ name: 'Ask', params }),
  bills: (params?: RootStackParamList['Bills']) => pathForRoute({ name: 'Bills', params }),
  legislators: () => pathForRoute({ name: 'Legislators' }),
  bill: (billId: string, params?: Omit<RootStackParamList['BillDetail'], 'billId'>) =>
    pathForRoute({ name: 'BillDetail', params: { billId, ...params } }),
  legislator: (legislatorId: string) =>
    pathForRoute({ name: 'LegislatorProfile', params: { legislatorId } }),
  vote: (billId: string, voteEventId: string) =>
    pathForRoute({ name: 'VoteDetail', params: { billId, voteEventId } }),
  findMyLegislator: () => pathForRoute({ name: 'FindMyLegislator' }),
  privacy: () => pathForRoute({ name: 'Privacy' }),
  terms: () => pathForRoute({ name: 'Terms' }),
};

/**
 * The click a browser is expected to handle itself rather than the app: ⌘-click
 * and Ctrl-click (new tab), Shift-click (new window), Alt-click (download), and
 * any non-primary mouse button. Middle-click fires `auxclick` rather than
 * `click` in current browsers, so it never reaches here at all — the button
 * check is belt-and-braces for anything that does dispatch one.
 *
 * react-native-web hands `onPress` the underlying click event, so these fields
 * are the real DOM ones (see PressResponder's `onClick`).
 */
type WebClickFields = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
  preventDefault?: () => void;
};

function browserHandlesClick(event: GestureResponderEvent | undefined) {
  const click = event as unknown as WebClickFields | undefined;
  if (!click) {
    return false;
  }
  return Boolean(
    click.metaKey ||
      click.ctrlKey ||
      click.shiftKey ||
      click.altKey ||
      (typeof click.button === 'number' && click.button !== 0),
  );
}

/**
 * Props that make a Pressable/Text a genuine link to an in-app page. Spread them
 * and drop the separate `onPress`/`accessibilityRole` — for example:
 *
 *     <Pressable {...linkProps(routePath.bill(bill.id), onOpen)} style={...}>
 *
 * On native there is no `href` to add, so this collapses to the role and the
 * original handler.
 *
 * Only apply it to an element that isn't already inside another link: nesting
 * one `<a>` in another is invalid markup and reads as a single confused control
 * to a screen reader.
 */
export function linkProps(
  href: string,
  onPress?: (event: GestureResponderEvent) => void,
): {
  accessibilityRole: 'link';
  href?: string;
  onPress?: (event: GestureResponderEvent) => void;
} {
  if (!isWeb) {
    return { accessibilityRole: 'link', onPress };
  }

  return {
    accessibilityRole: 'link',
    href,
    onPress: (event: GestureResponderEvent) => {
      if (browserHandlesClick(event)) {
        return;
      }
      // Without this the browser would follow the href itself and reload the
      // whole app instead of transitioning to the next screen in place.
      (event as unknown as WebClickFields)?.preventDefault?.();
      onPress?.(event);
    },
  };
}

/**
 * Wraps the `onPress` of a control that sits INSIDE a link — the author name, the
 * roll-calls chip and the Track button inside a bill card — so the surrounding
 * link doesn't fire on top of it.
 *
 * Such a control can't be a link of its own (an `<a>` inside an `<a>` is invalid
 * markup), and `stopPropagation` alone is not enough: it stops the card's own
 * handler, but the browser still performs the click's default action, which for
 * anything inside an anchor means following that anchor's URL. The result would
 * be the control doing its job and the page reloading onto the card's
 * destination. Cancelling the click as well is what keeps the two apart.
 *
 * A ⌘/Ctrl/Shift-click gets the same treatment on purpose: the browser would open
 * the surrounding card's URL, which is not the URL the person clicked. Sending
 * them to the right place in the current tab beats sending them to the wrong
 * place in a new one. Giving these controls real new-tab behaviour needs the card
 * markup restructured — issue #760.
 */
export function pressInsideLink(onPress?: (event: GestureResponderEvent) => void) {
  return (event: GestureResponderEvent) => {
    (event as unknown as WebClickFields)?.preventDefault?.();
    event?.stopPropagation?.();
    onPress?.(event);
  };
}

/**
 * Props for a link out to an official source (revisor.mn.gov, house.mn.gov, a
 * roll-call record). On web these become a plain `<a href target="_blank">`, so
 * the browser opens the new tab itself — right-click, ⌘-click and "Copy link
 * address" all work, and the URL shows in the status bar before the click. The
 * `onPress` is kept for native only, where there is no anchor and the URL has to
 * be handed to the OS (`Linking.openURL`).
 *
 * On web the handler is deliberately dropped: leaving a `window.open` call
 * alongside the href would open the destination twice on a single click.
 */
export function externalLinkProps(
  url: string,
  onPress?: (event: GestureResponderEvent) => void,
): {
  accessibilityRole: 'link';
  href?: string;
  hrefAttrs?: { target: '_blank'; rel: string };
  onPress?: (event: GestureResponderEvent) => void;
} {
  if (!isWeb) {
    return { accessibilityRole: 'link', onPress };
  }

  return {
    accessibilityRole: 'link',
    href: url,
    hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' },
  };
}
