import type { ContactAccountEmail } from './contactUs';

// The app shell publishes confirmed account changes even while Contact us is closed.
// Keep this bridge small so it does not load the contact screen or article registry.
const listeners = new Set<(account: ContactAccountEmail | null) => void>();

export function onContactDraftAccountChange(
  listener: (account: ContactAccountEmail | null) => void,
) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateContactDraftAccount(account: ContactAccountEmail | null) {
  listeners.forEach((listener) => listener(account));
}
