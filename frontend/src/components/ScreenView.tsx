import { PropsWithChildren, ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MotionIn } from './MotionIn';
import { useResponsive } from '../hooks/useResponsive';
import { theme } from '../theme/tokens';

interface ScreenViewProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ScreenView({ title, subtitle, actions, children }: ScreenViewProps) {
  const { isDesktop } = useResponsive();
  const webBackground = Platform.OS === 'web'
    ? ({
        backgroundColor: theme.colors.paper,
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23111111' fill-opacity='0.04' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'/%3E%3C/svg%3E\")",
      } as const)
    : { backgroundColor: theme.colors.paper };

  return (
    <View style={[styles.background, webBackground]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.container, isDesktop && styles.desktopContainer]}>
          <MotionIn delay={0}>
            <View style={styles.masthead}>
              <Text style={styles.mastheadLabel}>Alethical</Text>
              <Text style={styles.mastheadMeta}>Vol. 1 | March 21, 2026 | Civic Record</Text>
            </View>
          </MotionIn>
          <MotionIn delay={60}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              {actions ? <View style={styles.actions}>{actions}</View> : null}
            </View>
          </MotionIn>
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
    paddingBottom: theme.spacing.xxl,
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  mastheadMeta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    textTransform: 'uppercase',
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
  subtitle: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
    maxWidth: 720,
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
