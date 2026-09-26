import type { PageSnapshot } from './pageSnapshot';
import { PUBLISHED_PIECE_INDEX, piecePath } from './researchIndex';
import { SOCIAL_ACCOUNTS } from './socialLinks';

export const CONTACT_PAGE_HEADING = 'Contact us';
export const CONTACT_PAGE_SUBTITLE =
  "Questions about a bill, corrections to something we've published, or anything else";
export const CONTACT_EMAIL = 'ask@alethical.com';
export const CONTACT_SOCIALS = SOCIAL_ACCOUNTS;

export function contactPageSnapshot(): PageSnapshot {
  return {
    heading: CONTACT_PAGE_HEADING,
    subheading: CONTACT_PAGE_SUBTITLE,
    bodyHeading: '',
    body: [],
    facts: [],
    bodyIsList: false,
    links: [
      { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
      ...CONTACT_SOCIALS.flatMap((social) =>
        social.url ? [{ label: social.label, href: social.url }] : [],
      ),
    ],
  };
}

export const CONTACT_FIELD_ORDER = ['name', 'email', 'phone', 'subject', 'message'] as const;

export type ContactField = (typeof CONTACT_FIELD_ORDER)[number];
export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, string>>;

export type ContactFormState = {
  values: ContactValues;
  errors: ContactErrors;
  status: 'editing' | 'sending' | 'sent';
  sendFailed: boolean;
};

export const initialContactFormState: ContactFormState = {
  values: { name: '', email: '', phone: '', subject: '', message: '' },
  errors: {},
  status: 'editing',
  sendFailed: false,
};

/** A query carries an identity only. Titles and addresses come from the public registry. */
export function correctionContactValues(article?: string): ContactValues {
  const blank = { ...initialContactFormState.values };
  if (!article) return blank;
  const matches = PUBLISHED_PIECE_INDEX.filter(
    (piece) => (piece.articleId ?? piece.slug) === article,
  );
  if (matches.length !== 1) return blank;
  const piece = matches[0];
  const subject = `Possible correction: ${piece.title}`;
  const longTitle = subject.length > 200;
  const message = `I’d like to report a possible error in this article:\n${longTitle ? `${piece.title}\n` : ''}https://alethical.com${piecePath(piece)}\n\nWhat may be wrong:\n`;
  // Do not silently clip a title, URL or the reader's message to fit the API.
  if (message.length > 5000) return blank;
  return { ...blank, subject: longTitle ? 'Possible correction' : subject, message };
}

/**
 * One in-memory draft survives screen unmounts and pending sends. Nothing is
 * written to browser storage; closing/reloading the app discards the draft.
 */
export function createContactDraft(article?: string) {
  let state: ContactFormState = {
    ...initialContactFormState,
    values: correctionContactValues(article),
  };
  let edited = false;
  const listeners = new Set<() => void>();
  return {
    requestId: null as string | null,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prefill(article?: string) {
      if (edited || state.status !== 'editing' || Object.values(state.values).some(Boolean)) return;
      const values = correctionContactValues(article);
      if (!Object.values(values).some(Boolean)) return;
      state = { ...state, values };
      listeners.forEach((listener) => listener());
    },
    dispatch(action: ContactFormAction) {
      if (action.type === 'change') edited = true;
      if (action.type === 'reset') edited = false;
      state = contactFormReducer(state, action);
      listeners.forEach((listener) => listener());
    },
  };
}

export function validateContactForm(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) {
    errors.email = 'Enter an email address so we can reply';
  }
  if (!values.subject.trim()) {
    errors.subject = 'Add a subject';
  } else if (values.subject.length > 200) {
    errors.subject = 'Keep your subject to 200 characters or fewer';
  }
  if (!values.message.trim()) {
    errors.message = 'Write your message';
  } else if (values.message.length > 5000) {
    errors.message = 'Keep your message to 5000 characters or fewer';
  }
  return errors;
}

type ContactFormAction =
  | { type: 'change'; field: ContactField; value: string }
  | { type: 'validate'; errors: ContactErrors }
  | { type: 'submit' }
  | { type: 'failed' }
  | { type: 'sent' }
  | { type: 'reset' };

export function contactFormReducer(
  state: ContactFormState,
  action: ContactFormAction,
): ContactFormState {
  switch (action.type) {
    case 'change': {
      const errors = { ...state.errors };
      delete errors[action.field];
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors,
        sendFailed: false,
      };
    }
    case 'validate':
      return { ...state, errors: action.errors, sendFailed: false };
    case 'submit':
      return { ...state, status: 'sending', errors: {}, sendFailed: false };
    case 'failed':
      return { ...state, status: 'editing', sendFailed: true };
    case 'sent':
      return { ...state, status: 'sent', errors: {}, sendFailed: false };
    case 'reset':
      return initialContactFormState;
  }
}
