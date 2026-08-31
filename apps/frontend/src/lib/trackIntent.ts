import type { SignInRequest } from './signIn';

interface CurrentPage {
  pathname: string;
  search: string;
  hash: string;
  scrollY: number;
}

/** Build the complete Track request before Google replaces the page. */
export function trackSignInRequest(billId: string, page?: CurrentPage): SignInRequest {
  return {
    intent: 'track',
    billId,
    returnTo: page ? `${page.pathname}${page.search}${page.hash}` : undefined,
    scrollY: page ? Math.max(0, page.scrollY) : undefined,
  };
}

/** Read saved sign-in state defensively after the OAuth return trip. */
export function pendingSignInRequest(raw: string | null): SignInRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SignInRequest>;
    if (value.intent !== 'nav' && value.intent !== 'track') return null;
    if (
      value.returnTo &&
      (!value.returnTo.startsWith('/') ||
        value.returnTo.startsWith('//') ||
        value.returnTo.startsWith('/\\'))
    ) {
      return null;
    }
    if (value.intent === 'track' && !value.billId) return null;
    if (value.scrollY !== undefined && (!Number.isFinite(value.scrollY) || value.scrollY < 0)) {
      return null;
    }
    return {
      intent: value.intent,
      billId: value.billId,
      billCode: value.billCode,
      returnTo: value.returnTo,
      scrollY: value.scrollY,
      ...(typeof value.pendingReference === 'string' && value.pendingReference.length >= 32
        ? { pendingReference: value.pendingReference }
        : null),
      ...(value.pendingCompletion === 'ordinary' || value.pendingCompletion === 'email-link'
        ? { pendingCompletion: value.pendingCompletion }
        : null),
    };
  } catch {
    return null;
  }
}
