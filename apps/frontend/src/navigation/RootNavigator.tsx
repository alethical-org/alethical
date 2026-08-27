import {
  NavigationContainer,
  DefaultTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  ArrowLeft,
  BookmarkCheck,
  MessageSquareText,
  Home,
  MapPin,
  UserCircle,
  type Icon,
} from '../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountScreen } from '../screens/AccountScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ChatSessionScreen } from '../screens/ChatSessionScreen';
import { FindMyLegislatorScreen } from '../screens/FindMyLegislatorScreen';
import { LegislatorProfileScreen } from '../screens/LegislatorProfileScreen';
import { PrivacyScreen, TermsScreen } from '../screens/LegalScreens';
import { TrafficScreen } from '../screens/TrafficScreen';
import { VoteDetailScreen } from '../screens/VoteDetailScreen';
import { AskAnswerScreen } from '../screens/redesign/AskAnswerScreen';
import { AboutUsScreen } from '../screens/redesign/AboutUsScreen';
import { BillDetailScreen } from '../screens/redesign/BillDetailScreen';
import { HomeSignedOutScreen } from '../screens/redesign/HomeSignedOutScreen';
import { CommitteeListScreen } from '../screens/redesign/CommitteeListScreen';
import { CommitteeMoneyScreen } from '../screens/redesign/CommitteeMoneyScreen';
import { CommitteePaymentsScreen } from '../screens/redesign/CommitteePaymentsScreen';
import { MoneySearchScreen } from '../screens/redesign/MoneySearchScreen';
import { MoneyLandingScreen } from '../screens/redesign/MoneyLandingScreen';
import { ResearchScreen } from '../screens/redesign/ResearchScreen';
import { ReadScreen } from '../screens/redesign/ReadScreen';
import { NotFoundScreen } from '../screens/redesign/NotFoundScreen';
import { SearchBillsScreen } from '../screens/redesign/SearchBillsScreen';
import { SearchLegislatorsScreen } from '../screens/redesign/SearchLegislatorsScreen';
import { TrackedBillsScreen as TrackedScreen } from '../screens/redesign/TrackedBillsScreen';
import { ContactUsScreen } from '../screens/redesign/ContactUsScreen';
import { useAuth } from '../providers/AuthProvider';
import { useResponsive } from '../hooks/useResponsive';
import { documentTitleForRoute } from './documentTitle';
import { linkProps, routePath } from './links';
import {
  consumeWebHistoryReplaceMark,
  initializeWebHistory,
  pushWebHistory,
  replaceWebHistoryPath,
} from './webHistory';
import { MainTabParamList, MainTabScreenProps, RootStackParamList } from './types';
import { pathnameFromNavigationState, stateFromPathname } from './webRoutes';
import { theme } from '../theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
type NavIcon = Icon;
type RailRouteName = keyof MainTabParamList | 'FindMyLegislator' | 'NotFound' | 'SiteMetrics';
const tabMeta: Record<keyof MainTabParamList, { label: string; Icon: NavIcon }> = {
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
const railRoutes: Array<{
  name: RailRouteName;
  label: string;
  Icon: NavIcon;
  navigate: () => void;
}> = [
  {
    name: 'Home',
    ...tabMeta.Home,
    navigate: () => navigationRef.navigate('Tabs', { screen: 'Home' }),
  },
  {
    name: 'FindMyLegislator',
    label: 'Find My Rep',
    Icon: MapPin,
    navigate: () => navigationRef.navigate('FindMyLegislator'),
  },
  {
    name: 'Tracked',
    ...tabMeta.Tracked,
    navigate: () => navigationRef.navigate('Tabs', { screen: 'Tracked' }),
  },
];

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.paper,
    card: theme.colors.surface,
    text: theme.colors.ink,
    border: theme.colors.border,
    primary: theme.colors.primary,
  },
};

function RailLogo() {
  return (
    <View style={styles.railBrand}>
      <View style={styles.railMark} accessibilityLabel="Alethical logo">
        <View style={[styles.railMarkArm, styles.railMarkArmMint, styles.railMarkLeftTop]} />
        <View style={[styles.railMarkArm, styles.railMarkArmMint, styles.railMarkLeftBottom]} />
        <View style={[styles.railMarkArm, styles.railMarkArmBlue, styles.railMarkRightTop]} />
        <View style={[styles.railMarkArm, styles.railMarkArmBlue, styles.railMarkRightBottom]} />
      </View>
      <Text style={styles.railName}>Alethical</Text>
    </View>
  );
}

function DesktopRail({ activeRouteName }: { activeRouteName?: RailRouteName }) {
  return (
    <View style={styles.desktopRail}>
      <Pressable
        {...linkProps(routePath.home(), () => navigationRef.navigate('Tabs', { screen: 'Home' }))}
        accessibilityLabel="Alethical home"
        style={({ pressed }) => [styles.railHeader, pressed && styles.railBrandPressed]}
      >
        <RailLogo />
      </Pressable>

      <View style={styles.railDivider} />

      <View style={styles.railSection}>
        {railRoutes.map((route) => {
          const focused = activeRouteName === route.name;
          const iconColor = focused ? theme.colors.accent : theme.colors.ink;
          // Only Home and Find My Legislator are wired as addressable links here
          // (their URLs land back on this same item). Tracked, Chat and Account
          // stay plain pressables (rule 5, a link's URL must land where the click
          // lands). Find My Legislator joined the addressable ones when
          // /find-my-legislator stopped redirecting to Home (issue #764). Role
          // stays "tab" (not linkProps' "link") since these are still tabs in the
          // rail, just ones that are addressable.
          const addressablePath =
            route.name === 'Home'
              ? routePath.home()
              : route.name === 'FindMyLegislator'
                ? routePath.findMyLegislator()
                : null;
          const asLink = addressablePath ? linkProps(addressablePath, route.navigate) : null;
          return (
            <Pressable
              key={route.name}
              {...(asLink ?? { onPress: route.navigate })}
              accessibilityRole={asLink ? 'link' : 'button'}
              aria-current={focused ? 'page' : undefined}
              style={({ pressed }) => [
                styles.railItem,
                focused && styles.railItemActive,
                pressed && styles.railItemPressed,
              ]}
            >
              <View style={styles.railItemMain}>
                <route.Icon color={iconColor} size={22} strokeWidth={focused ? 2.7 : 2.1} />
                <Text
                  numberOfLines={1}
                  style={[styles.railItemLabel, focused && styles.railItemLabelActive]}
                >
                  {route.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MobileTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((route) =>
    VISIBLE_TABS.has(route.name as keyof MainTabParamList),
  );

  return (
    <View
      style={[styles.mobileTabBar, { paddingBottom: Math.max(theme.spacing.xs, insets.bottom) }]}
    >
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
    </View>
  );
}

// The site root always renders the v2 marketing home (full-bleed, with its own
// TopNav — see #143), signed in or out. Signing in works now (#1006), but a
// signed-in home page is not built, so there is nothing else to send anyone to;
// what changes when you sign in is the nav's account control, not this page.
function HomeRoute(_props: MainTabScreenProps<'Home'>) {
  return <HomeSignedOutScreen />;
}

/** True when the marketing home owns the page chrome. */
function useIsHome(activeTab: keyof MainTabParamList | undefined) {
  return activeTab === 'Home';
}

function MainTabs() {
  const { isDesktop } = useResponsive();
  const { isLoading, isSignedIn } = useAuth();

  return (
    <Tab.Navigator
      tabBar={
        isDesktop
          ? () => null
          : (props) => {
              const activeTab = props.state.routes[props.state.index]?.name as
                keyof MainTabParamList | undefined;
              if ((isLoading || !isSignedIn) && activeTab === 'Home') {
                return null;
              }
              // Tracked owns its chrome (SearchPageShell), so it hides the bottom
              // tab bar too — its mobile nav is the top-nav menu (#976).
              if (activeTab === 'Tracked') {
                return null;
              }
              return <MobileTabBar {...props} />;
            }
      }
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: theme.colors.paper,
        },
      }}
    >
      <Tab.Screen name="Home" component={HomeRoute} options={{ title: 'Home' }} />
      <Tab.Screen name="Tracked" component={TrackedScreen} options={{ title: 'Tracked' }} />
      <Tab.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}

function activeRailRouteFromRootState(state: any): RailRouteName | undefined {
  const rootRoute = state?.routes[state.index ?? 0];
  if (rootRoute?.name === 'FindMyLegislator') {
    return 'FindMyLegislator';
  }
  if (rootRoute?.name === 'NotFound') {
    return 'NotFound';
  }
  if (rootRoute?.name === 'SiteMetrics') {
    return 'SiteMetrics';
  }
  if (rootRoute?.name === 'Tabs') {
    const tabState = rootRoute.state;
    const tabRoute = tabState?.routes?.[tabState.index ?? 0];
    return tabRoute?.name as keyof MainTabParamList | undefined;
  }
  return undefined;
}

const styles = StyleSheet.create({
  globalShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.colors.paper,
  },
  globalShellMobile: {
    flex: 1,
    backgroundColor: theme.colors.paper,
  },
  globalContent: {
    flex: 1,
    minWidth: 0,
  },
  headerLeftContainer: {
    paddingLeft: theme.spacing.lg,
    paddingRight: theme.spacing.md,
  },
  headerTitleContainer: {
    marginLeft: 0,
    marginRight: theme.spacing.md,
  },
  headerBackButton: {
    width: 40,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerBackButtonPressed: {
    opacity: 0.72,
  },
  mobileTabBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
  },
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
  desktopRail: {
    width: 248,
    backgroundColor: theme.colors.surface,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  railHeader: {
    minHeight: 42,
    justifyContent: 'center',
  },
  railBrandPressed: {
    opacity: 0.82,
  },
  railBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  railMark: {
    width: 48,
    height: 32,
    position: 'relative',
  },
  railMarkArm: {
    position: 'absolute',
    width: 22,
    height: 8,
    borderRadius: 1,
  },
  railMarkArmMint: {
    backgroundColor: '#9DCABD',
  },
  railMarkArmBlue: {
    backgroundColor: '#1E6B8F',
  },
  railMarkLeftTop: {
    left: 0,
    top: 5,
    transform: [{ rotate: '28deg' }],
  },
  railMarkLeftBottom: {
    left: 0,
    bottom: 5,
    transform: [{ rotate: '-28deg' }],
  },
  railMarkRightTop: {
    right: 0,
    top: 5,
    transform: [{ rotate: '-28deg' }],
  },
  railMarkRightBottom: {
    right: 0,
    bottom: 5,
    transform: [{ rotate: '28deg' }],
  },
  railName: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 34,
    lineHeight: 34,
  },
  railDivider: {
    borderBottomWidth: 3,
    borderBottomColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  railSection: {
    gap: theme.spacing.sm,
    flex: 1,
  },
  railItem: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  railItemActive: {
    backgroundColor: theme.colors.surfaceAlt,
    borderLeftColor: theme.colors.accent,
  },
  railItemPressed: {
    opacity: 0.85,
  },
  railItemMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    minWidth: 0,
  },
  railItemLabel: {
    flexShrink: 1,
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 21,
    lineHeight: 25,
  },
  railItemLabelActive: {
    color: theme.colors.ink,
  },
});

export function RootNavigator() {
  const isWeb = Platform.OS === 'web';
  const { isDesktop } = useResponsive();
  const lastPathRef = useRef('/');
  const [activeRailRoute, setActiveRailRoute] = useState<RailRouteName | undefined>('Home');
  const isHome = useIsHome(activeRailRoute === 'Home' ? 'Home' : undefined);
  const usesOwnPageChrome =
    isHome ||
    activeRailRoute === 'Tracked' ||
    activeRailRoute === 'FindMyLegislator' ||
    activeRailRoute === 'NotFound' ||
    activeRailRoute === 'SiteMetrics';

  useEffect(() => {
    if (!isWeb) {
      return;
    }

    const onPopState = () => {
      if (!navigationRef.isReady()) {
        return;
      }

      // Include the query string: ?q= / ?subjectType= params live there and
      // targetFromPathname parses them (the pathname alone drops them).
      const fullPath = `${window.location.pathname}${window.location.search}` || '/';
      navigationRef.resetRoot(stateFromPathname(fullPath));
      lastPathRef.current = fullPath;
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [isWeb]);

  const initialState = useMemo(() => {
    if (!isWeb || typeof window === 'undefined') {
      return undefined;
    }

    lastPathRef.current = `${window.location.pathname}${window.location.search}` || '/';
    initializeWebHistory();
    return stateFromPathname(lastPathRef.current);
  }, [isWeb]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      initialState={initialState}
      documentTitle={{
        // Titles come from the shared page-wording builders, not from the screen's
        // navigation name — see navigation/documentTitle.ts for why.
        formatter: (_options, route) =>
          documentTitleForRoute(
            (route ?? { name: 'Home' }) as Parameters<typeof documentTitleForRoute>[0],
          ),
      }}
      onReady={() => {
        if (navigationRef.isReady()) {
          const rootState = navigationRef.getRootState();
          lastPathRef.current = pathnameFromNavigationState(rootState);
          const nextActiveRailRoute = activeRailRouteFromRootState(rootState);
          if (nextActiveRailRoute) {
            setActiveRailRoute(nextActiveRailRoute);
          }
        }
      }}
      onStateChange={(state) => {
        const nextActiveRailRoute = activeRailRouteFromRootState(state);
        if (nextActiveRailRoute) {
          setActiveRailRoute(nextActiveRailRoute);
        }
        if (!isWeb || !state) {
          return;
        }

        const nextPath = pathnameFromNavigationState(state);

        if (nextPath !== lastPathRef.current) {
          // A canonical forward (e.g. a committee address with a misspelled name
          // part) rewrites the address in place; anything else is a real step.
          if (consumeWebHistoryReplaceMark()) {
            replaceWebHistoryPath(nextPath);
          } else {
            pushWebHistory(nextPath);
          }
          lastPathRef.current = nextPath;
        }
      }}
    >
      <View style={isDesktop ? styles.globalShell : styles.globalShellMobile}>
        {/* Redesign pages bring their own top nav and footer, so they opt out of
            the old desktop rail instead of rendering both navigation systems. */}
        {isDesktop && !usesOwnPageChrome ? <DesktopRail activeRouteName={activeRailRoute} /> : null}
        <View style={styles.globalContent}>
          <Stack.Navigator
            screenOptions={({ navigation }) => ({
              headerShown: !isDesktop,
              headerBackVisible: false,
              headerTitleAlign: 'left',
              headerShadowVisible: false,
              headerStyle: {
                backgroundColor: theme.colors.surface,
              },
              headerTintColor: theme.colors.ink,
              headerLeft: () =>
                navigation.canGoBack() ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    hitSlop={10}
                    onPress={() => navigation.goBack()}
                    style={({ pressed }) => [
                      styles.headerBackButton,
                      pressed && styles.headerBackButtonPressed,
                    ]}
                  >
                    <ArrowLeft color={theme.colors.ink} size={32} strokeWidth={2.4} />
                  </Pressable>
                ) : null,
              headerLeftContainerStyle: styles.headerLeftContainer,
              headerTitleContainerStyle: styles.headerTitleContainer,
              headerTitleStyle: {
                color: theme.colors.ink,
                fontFamily: theme.typography.title,
                fontSize: 22,
              },
              contentStyle: {
                backgroundColor: theme.colors.paper,
              },
            })}
          >
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="Ask"
              component={AskAnswerScreen}
              options={{ headerShown: false, title: 'Ask' }}
            />
            <Stack.Screen
              name="BillDetail"
              component={BillDetailScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="LegislatorProfile"
              component={LegislatorProfileScreen}
              options={{ headerShown: false, title: 'Legislator' }}
            />
            <Stack.Screen
              name="FindMyLegislator"
              component={FindMyLegislatorScreen}
              options={{ headerShown: false, title: 'Find my legislator' }}
            />
            <Stack.Screen
              name="Bills"
              component={SearchBillsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Legislators"
              component={SearchLegislatorsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="MoneyLanding"
              component={MoneyLandingScreen}
              options={{ headerShown: false, title: 'Follow the money' }}
            />
            <Stack.Screen
              name="Read"
              component={ReadScreen}
              options={{ headerShown: false, title: 'Campaign money research' }}
            />
            <Stack.Screen
              name="Research"
              component={ResearchScreen}
              options={{ headerShown: false, title: 'Research' }}
            />
            {/* The same screen: a guide and a research piece are one document
                shape with different mastheads, so 2 route names exist only to
                write the 2 addresses. */}
            <Stack.Screen
              name="Guide"
              component={ResearchScreen}
              options={{ headerShown: false, title: 'Guide' }}
            />
            <Stack.Screen
              name="MoneySearch"
              component={MoneySearchScreen}
              options={{ headerShown: false, title: 'Search campaign money' }}
            />
            <Stack.Screen
              name="CommitteeList"
              component={CommitteeListScreen}
              options={{ headerShown: false, title: 'Committees' }}
            />
            <Stack.Screen
              name="CommitteeMoney"
              component={CommitteeMoneyScreen}
              options={{ headerShown: false, title: 'Committee' }}
            />
            <Stack.Screen
              name="CommitteePayments"
              component={CommitteePaymentsScreen}
              options={{ headerShown: false, title: 'Committee payments' }}
            />
            <Stack.Screen
              name="Privacy"
              component={PrivacyScreen}
              options={{ headerShown: false, title: 'Privacy Policy' }}
            />
            <Stack.Screen
              name="SiteMetrics"
              component={TrafficScreen}
              options={{ headerShown: false, title: 'Site Metrics' }}
            />
            <Stack.Screen
              name="Terms"
              component={TermsScreen}
              options={{ headerShown: false, title: 'Terms of Service' }}
            />
            <Stack.Screen
              name="AboutUs"
              component={AboutUsScreen}
              options={{ headerShown: false, title: 'About us' }}
            />
            <Stack.Screen
              name="ContactUs"
              component={ContactUsScreen}
              options={{ headerShown: false, title: 'Contact us' }}
            />
            <Stack.Screen
              name="NotFound"
              component={NotFoundScreen}
              options={{ headerShown: false, title: 'Page not found' }}
            />
            <Stack.Screen
              name="VoteDetail"
              component={VoteDetailScreen}
              options={{ title: 'Vote Detail' }}
            />
            <Stack.Screen
              name="ChatSession"
              component={ChatSessionScreen}
              options={{ title: 'Chat' }}
            />
          </Stack.Navigator>
        </View>
      </View>
    </NavigationContainer>
  );
}
