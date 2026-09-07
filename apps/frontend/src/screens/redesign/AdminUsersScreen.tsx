import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GoBackLink } from '../../components/GoBackLink';
import { SearchPageShell } from '../../components/search/searchPieces';
import { ApiError, searchAdminUsersFromApi } from '../../data/api';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useResponsive } from '../../hooks/useResponsive';
import {
  adminAccountDate,
  adminSignInMethods,
  type AdminUsersResult,
  type AdminUsersSearch,
} from '../../lib/adminUsers';
import { useDocumentTitle } from '../../navigation/documentTitle';
import type { MenuKey } from '../../navigation/ia';
import { routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import type { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

function Action({
  label,
  onPress,
  disabled = false,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const { focused, focusProps } = useFieldFocus();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
      {...focusProps}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selectedButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
        ...fieldFocusRing(focused),
      ]}
    >
      <Text style={[styles.buttonText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

function StateMessage({
  message,
  action,
  onPress,
  loading = false,
}: {
  message: string;
  action?: string;
  onPress?: () => void;
  loading?: boolean;
}) {
  return (
    <View style={styles.stateBox} accessibilityLiveRegion="polite" aria-busy={loading}>
      <Text style={styles.body}>{message}</Text>
      {action && onPress ? <Action label={action} onPress={onPress} /> : null}
    </View>
  );
}

type LoadedSearch = { search: AdminUsersSearch; attempt: number } & (
  { state: 'ready'; result: AdminUsersResult } | { state: 'error' | 'restricted' }
);

/** This component is destroyed on sign-out, account change, or lost permission. */
function PrivateUsers({ accessToken }: { accessToken: string }) {
  const { isMobile } = useResponsive();
  const { focused, focusProps } = useFieldFocus();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState<AdminUsersSearch>({
    query: '',
    status: 'all',
    created_within_days: null,
    offset: 0,
    limit: 25,
  });
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedSearch | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    void searchAdminUsersFromApi(accessToken, search, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoaded({ search, attempt, state: 'ready', result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            search,
            attempt,
            state: error instanceof ApiError && error.status === 403 ? 'restricted' : 'error',
          });
      },
    );
    return () => controller.abort();
  }, [accessToken, search, attempt]);

  const current = loaded?.search === search && loaded.attempt === attempt ? loaded : null;
  const result = current?.state === 'ready' ? current.result : null;
  const submit = () => setSearch((value) => ({ ...value, query: draft.trim(), offset: 0 }));
  const reset = () => {
    setDraft('');
    setSearch({ query: '', status: 'all', created_within_days: null, offset: 0, limit: 25 });
  };

  if (current?.state === 'restricted')
    return (
      <StateMessage message="Restricted access. This account does not have access to Users." />
    );

  return (
    <View style={styles.content}>
      {result ? (
        <View style={styles.summary}>
          {[
            ['Confirmed accounts', result.summary.confirmed_accounts],
            ['First confirmed today', result.summary.confirmed_today],
            ['First confirmed in last 7 days', result.summary.confirmed_7d],
            ['First confirmed in last 30 days', result.summary.confirmed_30d],
          ].map(([label, value]) => (
            <View key={label} style={[styles.metric, isMobile && styles.metricMobile]}>
              <Text style={styles.metricValue}>{Number(value).toLocaleString('en-US')}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.note}>
        Counts cover all included current accounts, regardless of filters. Today starts at midnight
        in Minnesota. Times below use Minnesota time.
      </Text>
      <View style={styles.filters}>
        <Text nativeID="admin-email-search-label" style={styles.label}>
          Search email
        </Text>
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="Search email"
            aria-labelledby="admin-email-search-label"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            maxLength={254}
            returnKeyType="search"
            placeholder="Email or part of an email"
            placeholderTextColor={t.colors.text.faint}
            {...focusProps}
            style={[styles.input, fieldOutlineReset, ...fieldFocusRing(focused)]}
          />
          <Action label="Search" onPress={submit} />
        </View>
        <View style={styles.filterGroup}>
          <Text style={styles.label}>
            Status
            {result ? ` · ${result.summary.pending_accounts.toLocaleString('en-US')} pending` : ''}
          </Text>
          <View style={styles.choices}>
            {(['all', 'confirmed', 'pending'] as const).map((status) => (
              <Action
                key={status}
                label={
                  status === 'all'
                    ? 'All accounts'
                    : status === 'confirmed'
                      ? 'Confirmed'
                      : 'Pending'
                }
                selected={search.status === status}
                onPress={() => setSearch((value) => ({ ...value, status, offset: 0 }))}
              />
            ))}
          </View>
        </View>
        <View style={styles.filterGroup}>
          <Text style={styles.label}>Signup date</Text>
          <View style={styles.choices}>
            {([null, 7, 30] as const).map((days) => (
              <Action
                key={days ?? 'all'}
                label={days === null ? 'Any signup date' : `Created in last ${days} days`}
                selected={search.created_within_days === days}
                onPress={() =>
                  setSearch((value) => ({ ...value, created_within_days: days, offset: 0 }))
                }
              />
            ))}
          </View>
        </View>
      </View>
      {!current ? (
        <StateMessage message="Loading accounts…" loading />
      ) : current.state === 'error' ? (
        <StateMessage
          message="We couldn’t load accounts. Try again."
          action="Retry"
          onPress={() => setAttempt((value) => value + 1)}
        />
      ) : result ? (
        <>
          <View style={styles.listHeading}>
            <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
              Accounts
            </Text>
            <Text style={styles.note}>Newest signups first</Text>
          </View>
          {result.data.length === 0 && result.page.total > 0 ? (
            <StateMessage
              message="No accounts on this page. Open the first page for current results."
              action="First page"
              onPress={() => setSearch((value) => ({ ...value, offset: 0 }))}
            />
          ) : result.data.length === 0 ? (
            <StateMessage
              message={
                result.page.total === 0 &&
                !search.query &&
                search.status === 'all' &&
                search.created_within_days === null
                  ? 'No included accounts yet.'
                  : 'No accounts match these filters.'
              }
              action="Clear filters"
              onPress={reset}
            />
          ) : (
            <View style={styles.list}>
              {result.data.map((account) => (
                <View key={account.id} style={[styles.account, isMobile && styles.accountMobile]}>
                  <View style={styles.accountIdentity}>
                    <Text selectable style={styles.email}>
                      {account.email ?? 'Email not available'}
                    </Text>
                    <Text style={styles.note}>
                      Sign-in method: {adminSignInMethods(account.sign_in_methods)}
                    </Text>
                  </View>
                  <View style={styles.accountDates}>
                    <Text style={styles.body}>
                      Signed up {adminAccountDate(account.created_at)}
                    </Text>
                    <Text
                      style={[styles.status, account.confirmed_at !== null && styles.confirmed]}
                    >
                      {account.confirmed_at
                        ? `Confirmed ${adminAccountDate(account.confirmed_at)}`
                        : 'Pending confirmation'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          <View style={styles.pagination}>
            <Text accessibilityLiveRegion="polite" style={styles.note}>
              {result.data.length
                ? `${result.page.offset + 1}–${result.page.offset + result.data.length} of ${result.page.total.toLocaleString('en-US')} ${result.page.total === 1 ? 'account' : 'accounts'}`
                : `${result.page.total.toLocaleString('en-US')} matching ${result.page.total === 1 ? 'account' : 'accounts'}`}
            </Text>
            <View style={styles.choices}>
              <Action
                label="Previous"
                disabled={result.page.offset === 0}
                onPress={() =>
                  setSearch((value) => ({
                    ...value,
                    offset: Math.max(0, result.page.offset - result.page.limit),
                  }))
                }
              />
              <Action
                label="Next"
                disabled={!result.page.has_more}
                onPress={() =>
                  setSearch((value) => ({
                    ...value,
                    offset: result.page.offset + result.page.limit,
                  }))
                }
              />
            </View>
          </View>
          <View style={styles.freshness}>
            <Text style={styles.note}>
              Source: Alethical sign-in records · Updated {adminAccountDate(result.as_of)}
            </Text>
            <Action label="Refresh" onPress={() => setAttempt((value) => value + 1)} />
          </View>
        </>
      ) : null}
    </View>
  );
}

export function AdminUsersScreen({ navigation }: RootScreenProps<'AdminUsers'>) {
  const { user, accessToken } = useAuth();
  const access = useAdminAccess();
  const { openSignIn } = useSignInModal();
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  useDocumentTitle('/admin/users', 'Users | Alethical');
  return (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={(item) => navigateTopNavItem(navigation, item)}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={
        <View>
          <GoBackLink
            href={routePath.home()}
            mobile={isMobile}
            onPress={() =>
              navigation.canGoBack()
                ? navigation.goBack()
                : navigation.navigate('Tabs', { screen: 'Home' })
            }
          />
          <Text style={styles.adminLabel}>Admin</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            Users
          </Text>
          <Text style={styles.subhead}>
            Current accounts and when they first confirmed. Team and test accounts are excluded from
            every count and result.
          </Text>
        </View>
      }
    >
      {access.state === 'signed-out' ? (
        <StateMessage
          message="Sign in with an administrator account to view Users."
          action="Sign in"
          onPress={() => openSignIn({ intent: 'nav', returnTo: '/admin/users' })}
        />
      ) : access.state === 'loading' ? (
        <StateMessage message="Checking access…" loading />
      ) : access.state === 'restricted' ? (
        <StateMessage message="Restricted access. This account does not have access to Users." />
      ) : access.state === 'error' ? (
        <StateMessage
          message="We couldn’t check access. Try again."
          action="Retry"
          onPress={access.retry}
        />
      ) : user && accessToken ? (
        <PrivateUsers key={`${user.id}:${accessToken}`} accessToken={accessToken} />
      ) : null}
    </SearchPageShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: 22, paddingBottom: 32 },
  adminLabel: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.green,
    marginBottom: 8,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 48,
    fontWeight: '800',
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 36 },
  h2: {
    fontFamily: t.typography.title,
    fontSize: 23,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  subhead: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.secondary,
    marginTop: 14,
    maxWidth: 720,
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: t.colors.text.primary,
  },
  note: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metric: {
    flex: 1,
    minWidth: 175,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radii.card,
    padding: 20,
    backgroundColor: t.colors.surface,
  },
  metricMobile: { minWidth: 135, padding: 16 },
  metricValue: {
    fontFamily: t.typography.title,
    fontSize: 32,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  metricLabel: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
    marginTop: 8,
  },
  filters: { gap: 10 },
  label: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontFamily: t.typography.body,
    fontSize: 16,
    color: t.colors.text.primary,
    backgroundColor: t.colors.surface,
  },
  filterGroup: { gap: 10, marginTop: 10 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    minHeight: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    backgroundColor: t.colors.surface,
  },
  buttonText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  selectedButton: { backgroundColor: t.colors.accentSoft, borderColor: t.colors.brand.deep },
  selectedText: { color: t.colors.text.green },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: t.colors.surfaceAlt },
  stateBox: { alignItems: 'flex-start', gap: 16, paddingVertical: 28 },
  listHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  list: { borderTopWidth: 1, borderColor: t.colors.border },
  account: {
    flexDirection: 'row',
    gap: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: t.colors.border,
  },
  accountMobile: { flexDirection: 'column', gap: 10 },
  accountIdentity: { flex: 1, minWidth: 0, gap: 6 },
  email: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text.primary,
    overflowWrap: 'anywhere',
  } as any,
  accountDates: { flex: 1, minWidth: 0, gap: 6 },
  status: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  confirmed: { color: t.colors.text.green },
  pagination: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  freshness: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: t.colors.border,
    paddingTop: 18,
  },
});
