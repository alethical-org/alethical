import { Component, ErrorInfo, PropsWithChildren, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme/tokens';

interface AppErrorBoundaryState {
  hasError: boolean;
}

export function AppFailureView({
  onReload,
  onClose,
  compact = false,
}: {
  onReload?: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = (name: string) => {
    if (
      typeof matchMedia !== 'undefined' &&
      matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches
    )
      setHovered(name);
  };
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.screen, compact && { minHeight: undefined, flex: undefined }]}
    >
      <View style={styles.card}>
        <Text accessibilityRole="header" aria-level={compact ? 2 : 1} style={styles.heading}>
          This page hit a problem
        </Text>
        {onReload ? <Text style={styles.body}>Reload the page to try again</Text> : null}
        {onReload ? (
          <Pressable
            onHoverIn={() => hover('reload')}
            onHoverOut={() => setHovered(null)}
            accessibilityRole="button"
            onPress={onReload}
            style={({ pressed }) => [
              styles.button,
              hovered === 'reload' && styles.buttonHovered,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonLabel}>Reload page</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            onHoverIn={() => hover('close')}
            onHoverOut={() => setHovered(null)}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              hovered === 'close' && styles.buttonHovered,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonLabel}>Close</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_error: Error): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled app render error', error, info);
  }

  private handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <AppFailureView onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.paper,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    gap: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  heading: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 17,
    lineHeight: 25,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.accent,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonHovered: {
    backgroundColor: theme.colors.brand.hover,
    borderColor: theme.colors.brand.hover,
  },
  buttonLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
});
