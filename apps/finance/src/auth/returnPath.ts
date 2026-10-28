import { safeReturnPath } from '../routes';

const KEY = 'alethical-finance-return-path';

/** Remember where to go after Google or an emailed link brings the reader back.
 * Kept for the whole browser, not 1 tab, because an emailed link opens a new tab;
 * it holds only a Finance address, and is cleared once used. */
export function rememberReturnPath(path: string) {
  try {
    window.localStorage.setItem(KEY, safeReturnPath(path));
  } catch {
    // Storage can be unavailable; the reader then lands on Finance home.
  }
}

export function takeReturnPath(): string {
  try {
    const value = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    return safeReturnPath(value);
  } catch {
    return '/';
  }
}
