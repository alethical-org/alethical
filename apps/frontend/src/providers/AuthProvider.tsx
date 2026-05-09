import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  isSignedIn: boolean;
  mode: 'demo';
  user: AuthUser | null;
  accessToken: string | null;
  signInDemo: () => void;
  signOut: () => void;
}

const demoUser: AuthUser = {
  id: 'user-demo-1',
  name: 'Ada Demo',
  email: 'ada@example.com',
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(demoUser);
  const accessToken = user ? process.env.EXPO_PUBLIC_DEV_AUTH_TOKEN ?? 'local-dev-token' : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      isSignedIn: Boolean(user),
      mode: 'demo',
      user,
      accessToken,
      signInDemo: () => setUser(demoUser),
      signOut: () => setUser(null),
    }),
    [accessToken, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
