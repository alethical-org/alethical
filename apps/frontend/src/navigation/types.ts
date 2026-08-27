import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { HomeLocationFailure } from '../lib/homeLegislatorFinder';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  Ask: {
    q?: string;
    sort?: string;
    billId?: string;
    legislatorId?: string;
    /** Position of a public question in this bill's saved suggestion list. */
    suggestionIndex?: number;
  };
  // Filter state lives in the URL query (issue #135) so a filtered Search Bills
  // view is shareable / bookmarkable / reload-safe. All optional; absent = default.
  Bills:
    | {
        q?: string;
        topic?: string;
        scope?: 'legislature';
        chamber?: string;
        status?: string;
        session?: string;
        issue?: string;
        omnibus?: string;
        sort?: string;
        page?: string;
      }
    | undefined;
  Legislators: undefined;
  BillDetail: {
    billId: string;
    // 'fulltext' is the retired name for 'text', still accepted so links shared
    // before the Bill Text tab was renamed keep resolving (BillDetailWebScreen's
    // LEGACY_TAB_PARAMS maps it).
    tab?: 'summary' | 'actions' | 'votes' | 'text' | 'versions' | 'fulltext';
    // Backward compatibility for old sign-in return links. New Track requests
    // return to their exact source page and no longer create this parameter.
    track?: boolean;
  };
  // `tab` is absent for the profile a reader lands on and only ever carries
  // 'money', so the ordinary URL stays /legislators/<slug> with no query string.
  // `year` rides in the URL for the same reason the tab does: a figure someone
  // sends to somebody else has to arrive showing the year they were looking at
  // (grounded-answers.md rule 5, "Anything linked to must be URL-addressable").
  LegislatorProfile: { legislatorId: string; tab?: 'money'; year?: string };
  // The address to look up rides in the route (and the URL query) so the home
  // page's Find field can hand off what the visitor typed, and so the results
  // are reload-safe / shareable (grounded-answers.md rule 5). Absent = the
  // screen opens with its own starting address and waits for input.
  FindMyLegislator:
    | {
        address?: string;
        /** One-time homepage lookup request. webRoutes deliberately never serializes it. */
        lookupAddress?: boolean;
        /** One-time homepage handoff. webRoutes deliberately never serializes it. */
        coordinate?: { latitude: number; longitude: number };
        /** One-time browser refusal/unavailability handoff, also never serialized. */
        locationFailure?: HomeLocationFailure;
      }
    | undefined;
  // Campaign money section (campaign money IA handoff, Aug 2026). All public —
  // the section has no sign-in gate.
  MoneyLanding: undefined;
  Reading: undefined;
  // One published piece of our own writing. Both names draw the same screen and
  // differ only in the address they write: a piece carrying the research trait
  // lives at /reading/research/{slug}, one carrying only the guide trait at
  // /reading/guides/{slug} (docs/architecture/published-writing-decisions.md
  // §2.1). The slug resolves against the piece registry (lib/research.ts); an
  // unknown slug, or the wrong folder for the piece, lands on NotFound.
  Research: { slug: string };
  Guide: { slug: string };
  // One committee's money page and its full-payments view. The slug's trailing
  // registration number is the identity and the only part that resolves — names
  // collide, numbers do not — so an old or misspelled name part still lands on
  // the page. `tab` and `year` ride in the address so a shared link carries what
  // the sender saw.
  CommitteeMoney: { slug: string; tab?: string; year?: string };
  CommitteePayments: { slug: string; tab?: string; year?: string };
  // The register of filers, A to Z. The name box, the kind filter and how many
  // rows are shown all ride in the address, so a narrowed or scrolled list is
  // shareable and survives Back (grounded-answers.md rule 5).
  CommitteeList: { q?: string; kind?: string; show?: string } | undefined;
  // One typed name matched across the 5 kinds of record. The query is the whole
  // state, so a results page is a link somebody can send.
  MoneySearch: { q?: string } | undefined;
  Privacy: undefined;
  SiteMetrics: undefined;
  Terms: undefined;
  AboutUs: undefined;
  ContactUs: undefined;
  ConfirmEmail: undefined;
  ResetPassword: undefined;
  NotFound: { path: string };
  VoteDetail: { billId: string; voteEventId: string };
  ChatSession: {
    sessionId?: string;
    seedPrompt?: string;
    subjectType?: 'bill';
    subjectId?: string;
    subjectLabel?: string;
    title?: string;
  };
};

export type MainTabParamList = {
  Home: undefined;
  Tracked: undefined;
  Chat: undefined;
  Account: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
