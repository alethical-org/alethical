import type { MoneyDetailsGroup } from './campaignMoneyDetails';

export const lobbyingPanelCopy = {
  loading: "Loading the Board's current lobbyist list",
  unavailable: "Could not load this registration from the Board's current lobbyist list.",
  retry: 'Try again',
  committeeLink: "See this committee's page",
  registration: (number: string) => `Registration ${number}`,
  registeredAs: (number: string, name: string) => `Registration ${number} · registered as ${name}`,
  notRegistered: (number: string) => `Registration ${number} · not registered today`,
  representsLink: (name: string) => `See who ${name} represents`,
} as const;

/** A name groups payments, never the distinct registrations printed on them. */
export function donationRegistrationNumbers(group: MoneyDetailsGroup): string[] {
  return [
    ...new Set(
      group.payments.flatMap((payment) =>
        'receivedOn' in payment && payment.contributorRegistrationNumber
          ? [payment.contributorRegistrationNumber]
          : [],
      ),
    ),
  ];
}

export function hasLobbyistLookupNumber(number: string): boolean {
  return /^\d{1,20}$/.test(number) && Number(number) > 0;
}
