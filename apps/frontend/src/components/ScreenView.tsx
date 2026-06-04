import { PropsWithChildren, ReactNode, useEffect, useRef } from 'react';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionIn } from './MotionIn';
import { useResponsive } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme/tokens';

interface ScreenViewProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  hideHeader?: boolean;
  hideMasthead?: boolean;
  scrollToEndKey?: unknown;
}

export function ScreenView({ title, subtitle, actions, hideHeader = false, hideMasthead = false, scrollToEndKey, children }: ScreenViewProps) {
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const scrollRef = useRef<ScrollView | null>(null);
  const safeAreaPadding = Platform.OS === 'web' ? undefined : { paddingTop: insets.top };
  const webBackground = Platform.OS === 'web'
    ? ({
        backgroundColor: theme.colors.paper,
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23111111' fill-opacity='0.04' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'/%3E%3C/svg%3E\")",
      } as const)
    : { backgroundColor: theme.colors.paper };

  useEffect(() => {
    if (scrollToEndKey === undefined) {
      return;
    }

    const timeout = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 0);

    return () => clearTimeout(timeout);
  }, [scrollToEndKey]);

  return (
    <View style={[styles.background, webBackground, safeAreaPadding]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={() => {
          if (scrollToEndKey !== undefined) {
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        <View style={[styles.container, isDesktop && styles.desktopContainer]}>
          {!hideMasthead ? (
            <MotionIn delay={0}>
              <View style={styles.masthead}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Alethical home"
                  onPress={() => navigation.navigate('Tabs', { screen: 'Home' })}
                  style={({ pressed }) => pressed && styles.mastheadPressed}
                >
                  <Text style={styles.mastheadLabel}>Alethical</Text>
                </Pressable>
              </View>
            </MotionIn>
          ) : null}
          {!hideHeader ? (
            <MotionIn delay={60}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  {title ? <Text style={[styles.title, !isDesktop && styles.mobileTitle]}>{title}</Text> : null}
                  {subtitle ? <Text style={[styles.subtitle, !isDesktop && styles.mobileSubtitle]}>{subtitle}</Text> : null}
                </View>
                {actions ? <View style={styles.actions}>{actions}</View> : null}
              </View>
            </MotionIn>
          ) : null}
          <MotionIn delay={120}>
            <View style={styles.content}>{children}</View>
          </MotionIn>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xl,
  },
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  desktopContainer: {
    maxWidth: theme.layout.maxWidth,
    paddingHorizontal: theme.spacing.xl,
  },
  masthead: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.sm,
  },
  mastheadLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  mastheadPressed: {
    opacity: 0.72,
  },
  header: {
    gap: theme.spacing.md,
    borderBottomWidth: 4,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.md,
  },
  headerText: {
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 52,
    lineHeight: 56,
  },
  mobileTitle: {
    fontSize: 44,
    lineHeight: 48,
  },
  subtitle: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
    maxWidth: 720,
  },
  mobileSubtitle: {
    fontSize: 16,
    lineHeight: 24,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  content: {
    gap: theme.spacing.lg,
  },
});
