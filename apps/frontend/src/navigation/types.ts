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
  LegislatorProfile: { legislatorId: string };
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
  // Internal demo: AI-simulation persona chat with a single hardcoded
  // legislator. URL-addressable at /legislator-chat but deliberately not linked
  // from product nav (internal-demo wall — docs/legislator-persona-chat-plan.md).
  LegislatorChat: undefined;
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
