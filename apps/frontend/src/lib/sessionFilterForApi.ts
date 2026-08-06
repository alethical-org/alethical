export function sessionFilterForApi(routeSession?: string): string | undefined {
  const explicitSession = routeSession?.trim();
  return explicitSession || undefined;
}
