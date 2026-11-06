import { useCallback } from 'react';

import { navigate, useLocation } from '../router';

/**
 * A page's in-page choices (tab, year, page, query, role) live in its address,
 * so Back, a copied link and a new tab all reopen the same view (Design build
 * notes, "Return context"). A change replaces the address rather than adding
 * a history step by default; a view transition can explicitly add one. A default
 * value is left out of the address.
 */
export function useAddressState<T extends Record<string, string>>(defaults: T) {
  const location = useLocation();
  const values = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = location.searchParams.get(String(key));
    if (value !== null) values[key] = value as T[keyof T];
  }
  const set = useCallback(
    (changes: Partial<T>, { replace = true } = {}) => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === '' || value === defaults[key]) params.delete(key);
        else params.set(key, String(value));
      }
      const query = params.toString();
      navigate(window.location.pathname + (query ? `?${query}` : ''), { replace });
    },
    // The defaults are written inline by each page; their values, not identity, matter.
    [JSON.stringify(defaults)],
  );
  return [values, set] as const;
}
