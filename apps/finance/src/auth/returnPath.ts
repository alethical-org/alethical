import { safeReturnPath } from '../routes';

const KEY = 'alethical-finance-return-path';

/** Remember where to go after Google or an emailed link brings the reader back. */
export function rememberReturnPath(path: string) {
  try {
    window.sessionStorage.setItem(KEY, safeReturnPath(path));
  } catch {
    // Storage can be unavailable; the reader then lands on Finance home.
  }
}

export function takeReturnPath(): string {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return safeReturnPath(value);
  } catch {
    return '/';
  }
}
