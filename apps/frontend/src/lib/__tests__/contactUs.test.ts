import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTACT_FIELD_ORDER,
  contactFormReducer,
  correctionContactValues,
  createContactDraft,
  initialContactFormState,
  validateContactForm,
} from '../contactUs';

import { PUBLISHED_PIECE_INDEX, piecePath, type PieceIndexEntry } from '../researchIndex';
import { ARTICLE_AI_NOTE, ARTICLE_SOURCE_NOTE, articleDisclosureRuns } from '../articleDisclosure';

const originalPieces = [...PUBLISHED_PIECE_INDEX];
afterEach(() => PUBLISHED_PIECE_INDEX.splice(0, PUBLISHED_PIECE_INDEX.length, ...originalPieces));

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

describe('article correction links', () => {
  it('resolves the approved title and canonical address from a published legacy slug', () => {
    const piece = PUBLISHED_PIECE_INDEX[0];
    expect(correctionContactValues(piece.slug)).toEqual({
      name: '',
      email: '',
      phone: '',
      subject: `Possible correction: ${piece.title}`,
      message: `I’d like to report a possible error in this article:\nhttps://alethical.com${piecePath(piece)}\n\nWhat may be wrong:\n`,
    });
  });

  it('uses a stable article identity rather than a replaceable slug when available', () => {
    PUBLISHED_PIECE_INDEX.push({
      ...PUBLISHED_PIECE_INDEX[0],
      articleId: 'stable-article',
      slug: 'renamed-article',
    });
    expect(correctionContactValues('stable-article').subject).toContain('Possible correction:');
    expect(correctionContactValues('renamed-article')).toEqual(initialContactFormState.values);
  });

  it.each([
    undefined,
    '',
    'unknown',
    '2-records-not-always-2-donations',
    '/private/draft',
    'http://127.0.0.1:8766/',
    'https://evil.example/article',
  ])('leaves the form blank for an absent, unknown or private identity: %s', (identity) => {
    expect(correctionContactValues(identity)).toEqual(initialContactFormState.values);
  });

  it('rejects an ambiguous identity rather than choosing the wrong article', () => {
    PUBLISHED_PIECE_INDEX.push({ ...PUBLISHED_PIECE_INDEX[0] });
    expect(correctionContactValues(PUBLISHED_PIECE_INDEX[0].slug)).toEqual(
      initialContactFormState.values,
    );
  });

  it('keeps a long title complete in the message and never exceeds either field limit', () => {
    const piece: PieceIndexEntry = {
      ...PUBLISHED_PIECE_INDEX[0],
      articleId: 'long-title',
      title: 'Long title '.repeat(30),
    };
    PUBLISHED_PIECE_INDEX.push(piece);
    const values = correctionContactValues('long-title');
    expect(values.subject).toBe('Possible correction');
    expect(values.message).toContain(piece.title);
    expect(validateContactForm({ ...values, email: 'reader@example.com' })).toEqual({});
    piece.title = 'x'.repeat(5000);
    expect(correctionContactValues('long-title')).toEqual(initialContactFormState.values);
  });

  it('enforces the subject and message limits on submission without clipping input', () => {
    expect(
      validateContactForm({ ...filled, subject: 'x'.repeat(201), message: 'y'.repeat(5001) }),
    ).toEqual({
      subject: 'Keep your subject to 200 characters or fewer',
      message: 'Keep your message to 5000 characters or fewer',
    });
  });

  it('adds only encoded identity to the shared note link and leaves ordinary links plain', () => {
    for (const text of [ARTICLE_AI_NOTE, ARTICLE_SOURCE_NOTE]) {
      expect(articleDisclosureRuns(text)[1]).toEqual({
        kind: 'internalLink',
        text: 'Contact us',
        href: '/about/contact',
      });
      expect(articleDisclosureRuns(text, 'article & title')[1]).toEqual({
        kind: 'internalLink',
        text: 'Contact us',
        href: '/about/contact?article=article%20%26%20title',
      });
      expect(
        articleDisclosureRuns(text, 'stable')
          .map((run) => run.text)
          .join(''),
      ).toBe(text);
    }
  });

  it('keeps a pending draft and retry identity in memory when the screen unsubscribes', () => {
    const draft = createContactDraft(PUBLISHED_PIECE_INDEX[0].slug);
    let notifications = 0;
    const unsubscribe = draft.subscribe(() => notifications++);
    draft.dispatch({ type: 'change', field: 'message', value: 'My own words' });
    draft.requestId = 'same-retry-id';
    draft.dispatch({ type: 'submit' });
    unsubscribe();
    draft.dispatch({ type: 'failed' });
    expect(notifications).toBe(2);
    expect(draft.getSnapshot().values.message).toBe('My own words');
    expect(draft.getSnapshot().sendFailed).toBe(true);
    expect(draft.requestId).toBe('same-retry-id');
  });
});
