import type { ComponentType } from 'react';

/**
 * Every screen the router can show, as its own downloadable piece.
 *
 * `import()` inside each loader is what makes the web build write a separate
 * file per screen instead of one file holding all 27. A page then downloads the
 * shared app plus the one screen it is showing, rather than the bill page, both
 * chat screens, the map lookup and the traffic dashboard as well (#1966).
 *
 * The keys are route names, matching `Stack.Screen`/`Tab.Screen` in
 * `RootNavigator.tsx`. `preloadScreenForPath` in `screenPreload.ts` reads the
 * same keys, so the address bar decides which piece is fetched first.
 */
export type ScreenLoader = () => Promise<{ default: ComponentType<any> }>;

export const screenChunks = {
  Home: () =>
    import('../screens/redesign/HomeSignedOutScreen').then((m) => ({
      default: m.HomeSignedOutScreen,
    })),
  Tracked: () =>
    import('../screens/redesign/TrackedBillsScreen').then((m) => ({
      default: m.TrackedBillsScreen,
    })),
  Chat: () => import('../screens/ChatScreen').then((m) => ({ default: m.ChatScreen })),
  Account: () => import('../screens/AccountScreen').then((m) => ({ default: m.AccountScreen })),
  Ask: () =>
    import('../screens/redesign/AskAnswerScreen').then((m) => ({ default: m.AskAnswerScreen })),
  BillDetail: () =>
    import('../screens/redesign/BillDetailScreen').then((m) => ({ default: m.BillDetailScreen })),
  // On a money-tab address the tab's own pieces download with the screen: see
  // `legislatorProfileScreenPieces` for the 2-step draw this removes.
  LegislatorProfile: () =>
    import('../screens/LegislatorProfileScreen').then((m) =>
      m.legislatorProfileScreenPieces().then(() => ({ default: m.LegislatorProfileScreen })),
    ),
  FindMyLegislator: () =>
    import('../screens/FindMyLegislatorScreen').then((m) => ({
      default: m.FindMyLegislatorScreen,
    })),
  Bills: () =>
    import('../screens/redesign/SearchBillsScreen').then((m) => ({ default: m.SearchBillsScreen })),
  Legislators: () =>
    import('../screens/redesign/SearchLegislatorsScreen').then((m) => ({
      default: m.SearchLegislatorsScreen,
    })),
  LobbyingLanding: () =>
    import('../screens/redesign/LobbyingLandingScreen').then((m) => ({
      default: m.LobbyingLandingScreen,
    })),
  LobbyingPrincipals: () =>
    import('../screens/redesign/LobbyingPrincipalsScreen').then((m) => ({
      default: m.LobbyingPrincipalsScreen,
    })),
  LobbyingLobbyists: () =>
    import('../screens/redesign/LobbyingLobbyistsScreen').then((m) => ({
      default: m.LobbyingLobbyistsScreen,
    })),
  LobbyingPrincipal: () =>
    import('../screens/redesign/LobbyingPrincipalScreen').then((m) => ({
      default: m.LobbyingPrincipalScreen,
    })),
  LobbyingLobbyist: () =>
    import('../screens/redesign/LobbyingLobbyistScreen').then((m) => ({
      default: m.LobbyingLobbyistScreen,
    })),
  MoneyLanding: () =>
    import('../screens/redesign/MoneyLandingScreen').then((m) => ({
      default: m.MoneyLandingScreen,
    })),
  EmailPreferences: () =>
    import('../screens/redesign/EmailPreferencesScreen').then((m) => ({
      default: m.EmailPreferencesScreen,
    })),
  Unsubscribe: () =>
    import('../screens/redesign/UnsubscribeScreen').then((m) => ({
      default: m.UnsubscribeScreen,
    })),
  Read: () => import('../screens/redesign/ReadScreen').then((m) => ({ default: m.ReadScreen })),
  ShortPosts: () =>
    import('../screens/redesign/ShortPostsScreen').then((m) => ({ default: m.ShortPostsScreen })),
  ReadTopic: () =>
    import('../screens/redesign/ShortPostsScreen').then((m) => ({ default: m.ShortPostsScreen })),
  Research: () =>
    import('../screens/redesign/ResearchScreen').then((m) => ({ default: m.ResearchScreen })),
  MoneySearch: () =>
    import('../screens/redesign/MoneySearchScreen').then((m) => ({ default: m.MoneySearchScreen })),
  PaymentsUnderName: () =>
    import('../screens/redesign/PaymentsUnderNameScreen').then((m) => ({
      default: m.PaymentsUnderNameScreen,
    })),
  OutsideSpending: () =>
    import('../screens/redesign/OutsideSpendingScreen').then((m) => ({
      default: m.OutsideSpendingScreen,
    })),
  CommitteeList: () =>
    import('../screens/redesign/CommitteeListScreen').then((m) => ({
      default: m.CommitteeListScreen,
    })),
  MoneyByRace: () =>
    import('../screens/redesign/MoneyByRaceScreen').then((m) => ({ default: m.MoneyByRaceScreen })),
  // The screen and the chart code it draws in its first frame, together: see
  // `committeeMoneyScreenPieces` for why the pieces are not fetched one after the other.
  CommitteeMoney: () =>
    import('../screens/redesign/CommitteeMoneyScreen').then((m) =>
      m.committeeMoneyScreenPieces().then(() => ({ default: m.CommitteeMoneyScreen })),
    ),
  CommitteePayments: () =>
    import('../screens/redesign/CommitteePaymentsScreen').then((m) => ({
      default: m.CommitteePaymentsScreen,
    })),
  Privacy: () => import('../screens/LegalScreens').then((m) => ({ default: m.PrivacyScreen })),
  AdminSiteMetrics: () =>
    import('../screens/metricsScreens').then((m) => ({
      default: m.AdminSiteMetricsScreen,
    })),
  AdminUsers: () =>
    import('../screens/redesign/AdminUsersScreen').then((m) => ({ default: m.AdminUsersScreen })),
  Terms: () => import('../screens/LegalScreens').then((m) => ({ default: m.TermsScreen })),
  SiteMetrics: () =>
    import('../screens/metricsScreens').then((m) => ({ default: m.TrafficScreen })),
  AboutUs: () =>
    import('../screens/redesign/AboutUsScreen').then((m) => ({ default: m.AboutUsScreen })),
  ContactUs: () =>
    import('../screens/redesign/ContactUsScreen').then((m) => ({ default: m.ContactUsScreen })),
  NotFound: () =>
    import('../screens/redesign/NotFoundScreen').then((m) => ({ default: m.NotFoundScreen })),
  VoteDetail: () =>
    import('../screens/VoteDetailScreen').then((m) => ({ default: m.VoteDetailScreen })),
  ChatSession: () =>
    import('../screens/ChatSessionScreen').then((m) => ({ default: m.ChatSessionScreen })),
} satisfies Record<string, ScreenLoader>;

export type ScreenChunkName = keyof typeof screenChunks;
