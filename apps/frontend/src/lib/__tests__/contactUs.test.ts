import { describe, expect, it } from 'vitest';

import {
  CONTACT_FIELD_ORDER,
  contactFormReducer,
  initialContactFormState,
  validateContactForm,
} from '../contactUs';

const filled = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '612-555-0199',
  subject: 'A correction',
  message: 'Please check the source link.',
};

describe('Contact us form rules', () => {
  it('keeps the accepted field order', () => {
    expect(CONTACT_FIELD_ORDER).toEqual(['name', 'email', 'phone', 'subject', 'message']);
  });

  it('shows the approved inline messages only after submit', () => {
    expect(initialContactFormState.errors).toEqual({});
    expect(validateContactForm(initialContactFormState.values)).toEqual({
      email: 'Enter an email address so we can reply',
      subject: 'Add a subject',
      message: 'Write your message',
    });
  });

  it('treats a malformed email as the missing reply path', () => {
    expect(validateContactForm({ ...filled, email: 'ada at example dot com' })).toEqual({
      email: 'Enter an email address so we can reply',
    });
  });

  it('never loses what the reader typed after delivery fails', () => {
    const ready = { ...initialContactFormState, values: filled };
    const sending = contactFormReducer(ready, { type: 'submit' });
    const failed = contactFormReducer(sending, { type: 'failed' });

    expect(sending.status).toBe('sending');
    expect(failed.status).toBe('editing');
    expect(failed.sendFailed).toBe(true);
    expect(failed.values).toEqual(filled);
  });

  it('replaces a successful form, then starts a clean message', () => {
    const ready = { ...initialContactFormState, values: filled };
    const sent = contactFormReducer(contactFormReducer(ready, { type: 'submit' }), {
      type: 'sent',
    });
    const reset = contactFormReducer(sent, { type: 'reset' });

    expect(sent.status).toBe('sent');
    expect(reset).toEqual(initialContactFormState);
  });
});
