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
  LegislatorProfile: () =>
    import('../screens/LegislatorProfileScreen').then((m) => ({
      default: m.LegislatorProfileScreen,
    })),
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
  MoneyLanding: () =>
    import('../screens/redesign/MoneyLandingScreen').then((m) => ({
      default: m.MoneyLandingScreen,
    })),
  Read: () => import('../screens/redesign/ReadScreen').then((m) => ({ default: m.ReadScreen })),
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
  CommitteeMoney: () =>
    import('../screens/redesign/CommitteeMoneyScreen').then((m) => ({
      default: m.CommitteeMoneyScreen,
    })),
  CommitteePayments: () =>
    import('../screens/redesign/CommitteePaymentsScreen').then((m) => ({
      default: m.CommitteePaymentsScreen,
    })),
  Privacy: () => import('../screens/LegalScreens').then((m) => ({ default: m.PrivacyScreen })),
  Terms: () => import('../screens/LegalScreens').then((m) => ({ default: m.TermsScreen })),
  SiteMetrics: () => import('../screens/TrafficScreen').then((m) => ({ default: m.TrafficScreen })),
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
