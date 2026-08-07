import { StyleSheet, Text } from 'react-native';

import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { theme } from '../theme/tokens';
import { Card } from './Card';
import { PrimaryButton } from './PrimaryButton';

interface AuthRequiredCardProps {
  title?: string;
  message: string;
  returnTo?: string;
}

// This card used to start Google sign-in itself, from a button with no Terms or
// Privacy line — a second, sloppier way in that bypassed the careful one. It now
// opens the one shared dialog, so there is exactly one sign-in surface, and the
// dialog owns the error wording too.
export function AuthRequiredCard({
  title = 'Sign in required',
  message,
  returnTo,
}: AuthRequiredCardProps) {
  const { isLoading } = useAuth();
  const { openSignIn } = useSignInModal();

  return (
    <Card>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.bodyText}>{isLoading ? 'Checking your session...' : message}</Text>
      <PrimaryButton label="Sign in" onPress={() => openSignIn({ intent: 'nav', returnTo })} />
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
});
