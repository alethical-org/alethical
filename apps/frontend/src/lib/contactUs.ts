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

export function validateContactForm(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) {
    errors.email = 'Enter an email address so we can reply';
  }
  if (!values.subject.trim()) {
    errors.subject = 'Add a subject';
  }
  if (!values.message.trim()) {
    errors.message = 'Write your message';
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
