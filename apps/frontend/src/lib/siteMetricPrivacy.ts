/** Match the private route after parsing and decoding its path, never its query. */
export function isPrivateMetricUrl(value: string): boolean {
  try {
    const path = decodeURIComponent(new URL(value, 'https://metrics.invalid').pathname)
      .replace(/\/+/g, '/')
      .toLowerCase();
    return path === '/admin' || path.startsWith('/admin/');
  } catch {
    // A malformed URL cannot be safely classified for collection.
    return true;
  }
}

export function isPrivateMetricLocation(): boolean {
  return typeof window !== 'undefined' && isPrivateMetricUrl(window.location.href);
}
