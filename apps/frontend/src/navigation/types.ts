import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  Ask: { q?: string };
  // Filter state lives in the URL query (issue #135) so a filtered Search Bills
  // view is shareable / bookmarkable / reload-safe. All optional; absent = default.
  Bills:
    | {
        q?: string;
        chamber?: string;
        status?: string;
        session?: string;
        issue?: string;
        omnibus?: string;
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
    // Intent-preserving track flow: a signed-out user who taps Track is sent
    // through sign-in and back to /bills/{id}?track=1; on return the screen
    // auto-completes the track and clears the param (grounded-answers.md rule 5).
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
        /** One-time homepage handoff. webRoutes deliberately never serializes it. */
        coordinate?: { latitude: number; longitude: number };
        /** One-time browser refusal/unavailability handoff, also never serialized. */
        locationFailure?: boolean;
      }
    | undefined;
  Privacy: undefined;
  Terms: undefined;
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
