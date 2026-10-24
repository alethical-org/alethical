import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkCheck, Home, MapPin, type Icon } from '../components/icons';
import { theme } from '../theme/tokens';
import { linkProps, routePath } from './links';

type RailDestination = 'Home' | 'FindMyLegislator' | 'Tracked';
const railRoutes: Array<{ name: RailDestination; label: string; Icon: Icon }> = [
  { name: 'Home', label: 'Home', Icon: Home },
  { name: 'FindMyLegislator', label: 'Find My Rep', Icon: MapPin },
  { name: 'Tracked', label: 'Tracked', Icon: BookmarkCheck },
];

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

export default function LegacyDesktopRailContent({
  activeRouteName,
  onNavigate,
}: {
  activeRouteName?: string;
  onNavigate: (route: RailDestination) => void;
}) {
  return (
    <>
      <Pressable
        {...linkProps(routePath.home(), () => onNavigate('Home'))}
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
          const asLink = addressablePath
            ? linkProps(addressablePath, () => onNavigate(route.name))
            : null;
          return (
            <Pressable
              key={route.name}
              {...(asLink ?? { onPress: () => onNavigate(route.name) })}
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
    </>
  );
}

const styles = StyleSheet.create({
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
