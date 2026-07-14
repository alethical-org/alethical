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
  Search,
  UserCircle,
  type LucideIcon,
} from 'lucide-react-native';
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountScreen } from '../screens/AccountScreen';
import { AskAnswerScreen } from '../screens/redesign/AskAnswerScreen';
import { BillDetailScreen } from '../screens/BillDetailScreen';
import { ChatSessionScreen } from '../screens/ChatSessionScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { FindMyLegislatorScreen } from '../screens/FindMyLegislatorScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { HomeSignedOutScreen } from '../screens/redesign/HomeSignedOutScreen';
import { PrivacyScreen, TermsScreen } from '../screens/LegalScreens';
import { LegislatorProfileScreen } from '../screens/LegislatorProfileScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { TrackedScreen } from '../screens/TrackedScreen';
import { VoteDetailScreen } from '../screens/VoteDetailScreen';
import { useAuth } from '../providers/AuthProvider';
import { useResponsive } from '../hooks/useResponsive';
import { MainTabParamList, RootStackParamList } from './types';
import { pathnameFromNavigationState, stateFromPathname } from './webRoutes';
import { theme } from '../theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
type NavIcon = LucideIcon;
type RailRouteName = keyof MainTabParamList | 'FindMyLegislator';
const tabMeta: Record<keyof MainTabParamList, { label: string; Icon: NavIcon }> = {
  Home: { label: 'Home', Icon: Home },
  Search: { label: 'Search', Icon: Search },
  Tracked: { label: 'Tracked', Icon: BookmarkCheck },
  Chat: { label: 'Chat', Icon: MessageSquareText },
  Account: { label: 'Account', Icon: UserCircle },
};
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
    name: 'Search',
    ...tabMeta.Search,
    navigate: () => navigationRef.navigate('Tabs', { screen: 'Search' }),
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
  {
    name: 'Chat',
    ...tabMeta.Chat,
    navigate: () => navigationRef.navigate('Tabs', { screen: 'Chat' }),
  },
  {
    name: 'Account',
    ...tabMeta.Account,
    navigate: () => navigationRef.navigate('Tabs', { screen: 'Account' }),
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
        accessibilityRole="link"
        accessibilityLabel="Alethical home"
        onPress={() => navigationRef.navigate('Tabs', { screen: 'Home' })}
        style={({ pressed }) => [styles.railHeader, pressed && styles.railBrandPressed]}
      >
        <RailLogo />
      </Pressable>

      <View style={styles.railDivider} />

      <View style={styles.railSection}>
        {railRoutes.map((route) => {
          const focused = activeRouteName === route.name;
          const iconColor = focused ? theme.colors.accent : theme.colors.ink;
          return (
            <Pressable
              key={route.name}
              accessibilityRole="tab"
              accessibilityState={focused ? { selected: true } : {}}
              onPress={route.navigate}
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
  const routes = state.routes;

  return (
    <View
      style={[styles.mobileTabBar, { paddingBottom: Math.max(theme.spacing.xs, insets.bottom) }]}
    >
      {routes.map((route) => {
        const routeName = route.name as keyof MainTabParamList;
        const focused = state.routes[state.index]?.key === route.key;
        const { Icon, label } = tabMeta[routeName];
        const color = focused ? theme.colors.accent : theme.colors.ink;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={focused ? { selected: true } : {}}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(routeName);
              }
            }}
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

// The site root is auth-aware: signed-out visitors get the v2 marketing home
// (full-bleed, with its own TopNav — see #143); signed-in users keep the
// existing app home. While the session restores, render nothing rather than
// flashing the wrong home.
function HomeRoute(props: ComponentProps<typeof HomeScreen>) {
  const { isLoading, isSignedIn } = useAuth();
  if (isLoading) {
    return null;
  }
  return isSignedIn ? <HomeScreen {...props} /> : <HomeSignedOutScreen />;
}

/** True when the current surface is the signed-out marketing home (hides the app chrome). */
function useIsSignedOutHome(activeTab: keyof MainTabParamList | undefined) {
  const { isLoading, isSignedIn } = useAuth();
  return !isSignedIn && !isLoading && activeTab === 'Home';
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
                | keyof MainTabParamList
                | undefined;
              if (!isSignedIn && !isLoading && activeTab === 'Home') {
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
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
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
  const isSignedOutHome = useIsSignedOutHome(
    activeRailRoute === 'FindMyLegislator' ? undefined : activeRailRoute,
  );

  useEffect(() => {
    if (!isWeb) {
      return;
    }

    const onPopState = () => {
      if (!navigationRef.isReady()) {
        return;
      }

      navigationRef.resetRoot(stateFromPathname(window.location.pathname || '/'));
      lastPathRef.current = window.location.pathname || '/';
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

    lastPathRef.current = window.location.pathname || '/';
    return stateFromPathname(lastPathRef.current);
  }, [isWeb]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      initialState={initialState}
      documentTitle={{
        formatter: (options, route) => {
          const pageTitle = options?.title ?? route?.name ?? 'Alethical';
          return `${pageTitle} | Alethical`;
        },
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
          window.history.pushState({}, '', nextPath);
          lastPathRef.current = nextPath;
        }
      }}
    >
      <View style={isDesktop ? styles.globalShell : styles.globalShellMobile}>
        {isDesktop && !isSignedOutHome ? <DesktopRail activeRouteName={activeRailRoute} /> : null}
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
              options={{ title: 'Legislator' }}
            />
            <Stack.Screen
              name="FindMyLegislator"
              component={FindMyLegislatorScreen}
              options={{ title: 'Find My Legislator' }}
            />
            <Stack.Screen
              name="Privacy"
              component={PrivacyScreen}
              options={{ title: 'Privacy Policy' }}
            />
            <Stack.Screen
              name="Terms"
              component={TermsScreen}
              options={{ title: 'Terms of Service' }}
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
