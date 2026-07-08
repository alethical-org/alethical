import { StyleSheet, Text } from 'react-native';

import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { Card } from './Card';
import { PrimaryButton } from './PrimaryButton';

interface AuthRequiredCardProps {
  title?: string;
  message: string;
  returnTo?: string;
}

export function AuthRequiredCard({
  title = 'Sign in required',
  message,
  returnTo,
}: AuthRequiredCardProps) {
  const { authError, isLoading, signInWithGoogle } = useAuth();

  return (
    <Card>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.bodyText}>{isLoading ? 'Checking your session...' : message}</Text>
      {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
      <PrimaryButton label="Continue With Google" onPress={() => void signInWithGoogle(returnTo)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  errorText: {
    color: theme.colors.danger,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
});
