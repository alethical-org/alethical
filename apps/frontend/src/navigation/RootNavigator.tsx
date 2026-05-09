import {
  NavigationContainer,
  DefaultTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AccountScreen } from '../screens/AccountScreen';
import { BillDetailScreen } from '../screens/BillDetailScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatSessionScreen } from '../screens/ChatSessionScreen';
import { FindMyLegislatorScreen } from '../screens/FindMyLegislatorScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LegislatorProfileScreen } from '../screens/LegislatorProfileScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { TrackedScreen } from '../screens/TrackedScreen';
import { VoteDetailScreen } from '../screens/VoteDetailScreen';
import { useResponsive } from '../hooks/useResponsive';
import { useAuth } from '../providers/AuthProvider';
import { MainTabParamList, RootStackParamList } from './types';
import { pathnameFromNavigationState, stateFromPathname } from './webRoutes';
import { theme } from '../theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

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

function TabLabel({ label }: { label: string }) {
  return (
    <Text style={{ fontFamily: theme.typography.body, fontSize: 13, fontWeight: '700' }}>
      {label}
    </Text>
  );
}

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

function DesktopTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { isSignedIn } = useAuth();
  const visibleRoutes = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => isSignedIn || route.name !== 'Account');

  return (
    <View style={styles.desktopRail}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Alethical home"
        onPress={() => navigation.navigate('Home')}
        style={({ pressed }) => [styles.railHeader, pressed && styles.railBrandPressed]}
      >
        <RailLogo />
      </Pressable>

      <View style={styles.railDivider} />

      <View style={styles.railSection}>
        <Text style={styles.railSectionLabel}>Desk</Text>
        {visibleRoutes.map(({ route, index }, visibleIndex) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label =
            typeof options.title === 'string'
              ? options.title
              : typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : route.name;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={focused ? { selected: true } : {}}
              onPress={() => navigation.navigate(route.name)}
              style={({ pressed }) => [
                styles.railItem,
                focused && styles.railItemActive,
                pressed && styles.railItemPressed,
              ]}
            >
              <View style={styles.railItemTop}>
                <Text style={[styles.railIndex, focused && styles.railIndexActive]}>
                  {String(visibleIndex + 1).padStart(2, '0')}
                </Text>
              </View>
              <Text style={[styles.railItemLabel, focused && styles.railItemLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MainTabs() {
  const { isDesktop } = useResponsive();
  const { isSignedIn } = useAuth();

  return (
    <Tab.Navigator
      tabBar={(props) => (isDesktop ? <DesktopTabBar {...props} /> : undefined)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? 'left' : 'bottom',
        tabBarLabelStyle: {
          fontFamily: theme.typography.ui,
          fontSize: 12,
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 1.2,
        },
        tabBarStyle: isDesktop
          ? {
              display: 'none',
              width: 240,
              borderRightWidth: 1,
              borderTopWidth: 0,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              paddingTop: theme.spacing.lg,
            }
          : {
              borderTopWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              paddingBottom: theme.spacing.xs,
              height: 72,
            },
        tabBarActiveTintColor: theme.colors.white,
        tabBarInactiveTintColor: theme.colors.ink,
        tabBarActiveBackgroundColor: theme.colors.ink,
        tabBarInactiveBackgroundColor: theme.colors.surface,
        sceneStyle: {
          backgroundColor: theme.colors.paper,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', tabBarLabel: () => <TabLabel label="Home" />, tabBarIcon: () => null }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: 'Search', tabBarLabel: () => <TabLabel label="Search" />, tabBarIcon: () => null }}
      />
      <Tab.Screen
        name="Tracked"
        component={TrackedScreen}
        options={{ title: 'Tracked', tabBarLabel: () => <TabLabel label="Tracked" />, tabBarIcon: () => null }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatListScreen}
        options={{ title: 'Chat', tabBarLabel: () => <TabLabel label="Chat" />, tabBarIcon: () => null }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: 'Account',
          tabBarLabel: () => <TabLabel label="Account" />,
          tabBarIcon: () => null,
          tabBarButton: isSignedIn ? undefined : () => null,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
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
  railSectionLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  railItem: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    gap: 2,
  },
  railItemActive: {
    backgroundColor: theme.colors.surfaceAlt,
    borderLeftColor: theme.colors.accent,
  },
  railItemPressed: {
    opacity: 0.85,
  },
  railItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  railIndex: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 11,
  },
  railIndexActive: {
    color: theme.colors.accent,
  },
  railItemLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
    lineHeight: 30,
  },
  railItemLabelActive: {
    color: theme.colors.ink,
  },
});

export function RootNavigator() {
  const isWeb = Platform.OS === 'web';
  const lastPathRef = useRef('/');

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
          lastPathRef.current = pathnameFromNavigationState(navigationRef.getRootState());
        }
      }}
      onStateChange={(state) => {
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
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: theme.colors.surface,
          },
          headerTintColor: theme.colors.ink,
          headerTitleStyle: {
            color: theme.colors.ink,
            fontFamily: theme.typography.title,
            fontSize: 22,
          },
          contentStyle: {
            backgroundColor: theme.colors.paper,
          },
        }}
      >
        <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="BillDetail" component={BillDetailScreen} options={{ title: 'Bill' }} />
        <Stack.Screen name="LegislatorProfile" component={LegislatorProfileScreen} options={{ title: 'Legislator' }} />
        <Stack.Screen name="FindMyLegislator" component={FindMyLegislatorScreen} options={{ title: 'Find My Legislator' }} />
        <Stack.Screen name="VoteDetail" component={VoteDetailScreen} options={{ title: 'Vote Detail' }} />
        <Stack.Screen name="ChatSession" component={ChatSessionScreen} options={{ title: 'Chat' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
