export async function unregisterServiceWorkers(
  navigatorValue: Navigator | undefined,
): Promise<void> {
  const serviceWorker = navigatorValue?.serviceWorker;
  if (!serviceWorker) {
    return;
  }

  const registrations = await serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}
