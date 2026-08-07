import { Component, ErrorInfo, PropsWithChildren } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme/tokens';

interface AppErrorBoundaryState {
  hasError: boolean;
}

export function AppFailureView({ onReload }: { onReload: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          This page hit a problem
        </Text>
        <Text style={styles.body}>Reload the page to try again.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onReload}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>Reload page</Text>
        </Pressable>
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
  buttonLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
});
