/** Finance-only sessions. No password is saved in the browser. */
export const RESEARCH_SESSION_KEY = 'alethical-finance-research-session';
export interface ResearchSession {
  access_token: string;
  email: string;
  expires_at: string;
}

export function readResearchSession(): ResearchSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(RESEARCH_SESSION_KEY) ?? 'null');
    if (
      value &&
      typeof value.access_token === 'string' &&
      /^finance_research_[A-Za-z0-9_-]{40,100}$/.test(value.access_token) &&
      typeof value.email === 'string' &&
      typeof value.expires_at === 'string' &&
      Date.parse(value.expires_at) > Date.now()
    )
      return value;
  } catch {
    /* Unavailable storage or malformed saved state starts signed out. */
  }
  return null;
}

export function saveResearchSession(value: ResearchSession | null) {
  try {
    if (value) window.localStorage.setItem(RESEARCH_SESSION_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(RESEARCH_SESSION_KEY);
  } catch {
    /* In-memory access still works when browser storage is blocked. */
  }
}
