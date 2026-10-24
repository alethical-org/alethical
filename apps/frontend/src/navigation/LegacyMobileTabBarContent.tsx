import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text } from 'react-native';
import { BookmarkCheck, MessageSquareText, Home, UserCircle, type Icon } from '../components/icons';
import type { MainTabParamList } from './types';
import { linkProps, routePath } from './links';
import { theme } from '../theme/tokens';

const tabMeta: Record<keyof MainTabParamList, { label: string; Icon: Icon }> = {
  Home: { label: 'Home', Icon: Home },
  Tracked: { label: 'Tracked', Icon: BookmarkCheck },
  Chat: { label: 'Chat', Icon: MessageSquareText },
  Account: { label: 'Account', Icon: UserCircle },
};
/**
 * The tabs a person can actually reach from the sidebar and the phone tab row.
 * Chat and Account are deliberately absent: both are pre-redesign screens wired
 * to fixture data, and now that signing in works, a link to either would land
 * someone on a page we stopped maintaining. Their URLs already redirect Home
 * (navigation/webRoutes.ts).
 *
 * This comment used to add "and the bill-scoped chat is untouched — it opens
 * from a bill page". That is false and was false when written: webRoutes.ts
 * redirects /chat/new and /chat/sessions/{id} to Home as well, so hiding the tab
 * is not the only thing standing between a reader and a chat, and the bill-page
 * entry it referred to was deleted with BillDetailScreen.tsx (#1071). The screen
 * and the server endpoints both still work — only the way in is gone. Tracked in
 * #1032; grounded-answers.md rule 8 carries the detail.
 */
const VISIBLE_TABS: ReadonlySet<keyof MainTabParamList> = new Set(['Home', 'Tracked']);

export default function LegacyMobileTabBarContent({ state, navigation }: BottomTabBarProps) {
  const routes = state.routes.filter((route) =>
    VISIBLE_TABS.has(route.name as keyof MainTabParamList),
  );

  return (
    <>
      {routes.map((route) => {
        const routeName = route.name as keyof MainTabParamList;
        const focused = state.routes[state.index]?.key === route.key;
        const { Icon, label } = tabMeta[routeName];
        const color = focused ? theme.colors.accent : theme.colors.ink;
        const navigateToTab = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(routeName);
          }
        };
        // Same round-trip rule as the desktop rail (see DesktopRail above): only
        // Home's URL lands back on Home, so it's the only tab that gets a href.
        const home = routeName === 'Home' ? linkProps(routePath.home(), navigateToTab) : null;

        return (
          <Pressable
            key={route.key}
            {...(home ?? { onPress: navigateToTab })}
            accessibilityRole={home ? 'link' : 'button'}
            accessibilityLabel={label}
            aria-current={focused ? 'page' : undefined}
            style={({ pressed }) => [
              styles.mobileTabItem,
              focused && styles.mobileTabItemActive,
              pressed && styles.mobileTabItemPressed,
            ]}
          >
            <Icon color={color} size={21} strokeWidth={focused ? 2.8 : 2.1} />
            <Text style={[styles.mobileTabLabel, focused && styles.mobileTabLabelActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  mobileTabItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderTopWidth: 3,
    borderTopColor: 'transparent',
    paddingHorizontal: 2,
  },
  mobileTabItemActive: {
    borderTopColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceAlt,
  },
  mobileTabItemPressed: {
    opacity: 0.82,
  },
  mobileTabLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 12,
  },
  mobileTabLabelActive: {
    color: theme.colors.ink,
  },
});
