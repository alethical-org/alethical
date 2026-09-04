import { NotificationPreference, SavedPlace } from './types';

/**
 * The 3 stand-in answers the account screen asks for.
 *
 * They lived in `mockData.ts` beside sample bills, legislators and chat
 * transcripts. `useAppQueries.ts` imported these 3 and nothing else from that
 * file, and `useAppQueries.ts` is in the program every page downloads first, so
 * 27,644 characters of sample records rode along on every page a reader opened,
 * about 4,500 bytes compressed (#1966). They are here so they can be reached
 * without carrying the rest.
 *
 * Nothing real is behind them. There is no account screen a reader can reach:
 * `/account` redirects to the home page (`navigation/webRoutes.ts`) and the
 * Account tab is not in `VISIBLE_TABS` (`navigation/RootNavigator.tsx`), so the
 * only caller, `screens/AccountScreen.tsx`, cannot be opened. Whether that
 * screen ships at all is a product question rather than a cleanup, which is why
 * these answers are moved rather than deleted
 * (`docs/operations/page-load-performance-decisions.md`, remaining options).
 */
const demoUserId = 'user-demo-1';

const store: { notificationPreference: NotificationPreference; savedPlaces: SavedPlace[] } = {
  notificationPreference: {
    billUpdates: true,
    weeklyDigest: true,
    hearingAlerts: false,
  },
  savedPlaces: [
    {
      id: 'place-home',
      label: 'Home',
      address: 'South Minneapolis, MN 55409',
      districtSummary: 'Senate 62, House 61B',
    },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function wait(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getNotificationPreference(
  userId: string,
): Promise<NotificationPreference | null> {
  await wait();
  if (userId !== demoUserId) {
    return null;
  }

  return clone(store.notificationPreference);
}

export async function updateNotificationPreference(
  userId: string,
  key: keyof NotificationPreference,
  value: boolean,
): Promise<NotificationPreference | null> {
  await wait();
  if (userId !== demoUserId) {
    return null;
  }

  store.notificationPreference = {
    ...store.notificationPreference,
    [key]: value,
  };

  return clone(store.notificationPreference);
}

export async function listSavedPlaces(userId: string): Promise<SavedPlace[]> {
  await wait();
  if (userId !== demoUserId) {
    return [];
  }

  return clone(store.savedPlaces);
}
