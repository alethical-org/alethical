import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  BillDetail: { billId: string };
  LegislatorProfile: { legislatorId: string };
  FindMyLegislator: undefined;
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
