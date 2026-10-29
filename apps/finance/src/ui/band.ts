import { useSyncExternalStore } from 'react';

/** Design's 3 layout bands: phone below 768, tablet 768 to 1099, computer 1100 and up. */
export type Band = 'phone' | 'tablet' | 'computer';

const QUERIES = {
  phone: '(max-width: 767px)',
  computer: '(min-width: 1100px)',
} as const;

function read(): Band {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'computer';
  if (window.matchMedia(QUERIES.phone).matches) return 'phone';
  if (window.matchMedia(QUERIES.computer).matches) return 'computer';
  return 'tablet';
}

function subscribe(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', listener);
  return () => {
    for (const list of lists) list.removeEventListener('change', listener);
  };
}

export function useBand(): Band {
  return useSyncExternalStore(subscribe, read, () => 'computer');
}
