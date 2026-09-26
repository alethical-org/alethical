import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Requires the task's disposable PostgreSQL API on 18261 and fake Supabase app
// on 19261. This suite refuses production and blocks every external request.
const api = 'http://127.0.0.1:18261';
const article = '/read/guides/what-the-records-name';
const articleId = 'guide-what-the-records-name';
const accounts = {
  reader: {
    token: 'qa-reader-one',
    subject: '00000000-0000-4000-8000-000000000001',
    email: 'reader-one@example.invalid',
  },
  second: {
    token: 'qa-reader-two',
    subject: '00000000-0000-4000-8000-000000000002',
    email: 'reader-two@example.invalid',
  },
  admin: {
    token: 'qa-admin',
    subject: '00000000-0000-4000-8000-000000000003',
    email: 'ask@alethical.com',
  },
};

async function localBrowser(browser: Browser, kind?: keyof typeof accounts) {
  const base = new URL(test.info().project.use.baseURL!);
  if (base.origin !== 'http://127.0.0.1:19261') {
    throw new Error('Comments writing tests require the isolated local app on 127.0.0.1:19261');
  }
  const context = await browser.newContext({ viewport: { width: 1240, height: 900 } });
  const account = kind ? accounts[kind] : null;
  if (account)
    await context.addInitScript((account) => {
      if (window.location.origin !== 'http://127.0.0.1:19261') return;
      localStorage.setItem(
        'sb-127-auth-token',
        JSON.stringify({
          access_token: account.token,
          refresh_token: 'qa-only-fake-refresh-token',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: account.subject,
            aud: 'authenticated',
            role: 'authenticated',
            email: account.email,
            app_metadata: { provider: 'email', providers: ['email'] },
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      );
    }, account);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base.origin || url.origin === api) return route.continue();
    if (url.origin === 'http://127.0.0.1:8991' && account && url.pathname === '/auth/v1/user') {
      return route.fulfill({
        json: {
          id: account.subject,
          email: account.email,
          email_confirmed_at: '2026-01-01T00:00:00Z',
          app_metadata: { provider: 'email' },
          user_metadata: {},
        },
      });
    }
    return route.fulfill({
      status: 404,
      body: 'External requests are disabled in this local test',
    });
  });
  const page = await context.newPage();
  return {
    context,
    page,
    go: (path: string) => page.goto(`${base.origin}${path}`, { waitUntil: 'domcontentloaded' }),
  };
}

async function chooseName(page: Page, name: string) {
  const field = page.getByRole('textbox', { name: 'Public name', exact: true }).last();
  if (await field.isVisible()) await field.fill(name);
}

test.describe('editorial comments with a real local database', () => {
  test.skip(
    ({ baseURL }) => baseURL !== 'http://127.0.0.1:19261',
    'Requires the dedicated disposable comments test system',
  );
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('editorial reading and signed-out comment entry work on phone and desktop', async ({
    browser,
  }) => {
    const { context, page, go } = await localBrowser(browser);
    try {
      await go(article);
      await expect(page.getByRole('heading', { name: 'Reader comments' })).toBeVisible();
      await page.getByRole('button', { name: 'Sign in to comment', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(
        page.getByText('Names are chosen by readers and are not verified'),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await go('/read');
      await expect(page.getByRole('heading', { name: 'Read', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Reader comments' })).toHaveCount(0);
      const money = await context.newPage();
      await money.goto('http://127.0.0.1:19261/money');
      await expect(
        money.getByRole('heading', { name: 'Money in politics', exact: true }),
      ).toBeVisible();
      await expect(money.getByRole('heading', { name: 'Reader comments' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('readers post, reply, rename, edit and preserve replies when a parent is deleted', async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    try {
      const first = await localBrowser(browser, 'reader');
      contexts.push(first.context);
      await first.go(article);
      await expect(
        first.page.getByRole('textbox', { name: 'Write a comment', exact: true }),
      ).toBeVisible();
      await chooseName(first.page, 'R');
      const original = `Local discussion ${Date.now()}`;
      await first.page
        .getByRole('textbox', { name: 'Write a comment', exact: true })
        .fill(original);
      await first.page.getByRole('button', { name: 'Post comment', exact: true }).click();
      const postedRoot = first.page
        .getByRole('article')
        .filter({ has: first.page.getByText(original, { exact: true }) })
        .last();
      await expect(postedRoot).toBeVisible();
      const rootId = await postedRoot.getAttribute('id');
      const root = first.page.locator(`[id="${rootId}"]`);
      await expect(root.getByText(/^Posted /)).toBeVisible();
      await root.getByRole('button', { name: 'Edit', exact: true }).click();
      const edited = `${original} updated`;
      await root.getByRole('textbox').fill(edited);
      await root.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(first.page.getByText(edited, { exact: true })).toBeVisible();
      await expect(first.page.getByText(/Posted .+ · Edited /).last()).toBeVisible();
      await first.page.getByRole('button', { name: 'Change name', exact: true }).first().click();
      await first.page
        .getByRole('textbox', { name: 'Public name', exact: true })
        .first()
        .fill('Rowan');
      await first.page.getByRole('button', { name: 'Save name', exact: true }).click();
      await expect(first.page.getByText('Name updated', { exact: true })).toBeVisible();

      const second = await localBrowser(browser, 'second');
      contexts.push(second.context);
      await second.go(article);
      const target = second.page
        .getByRole('article')
        .filter({ has: second.page.getByText(edited, { exact: true }) })
        .last();
      await expect(target.getByText('Rowan', { exact: true })).toBeVisible();
      await target.getByRole('button', { name: 'Reply', exact: true }).click();
      await chooseName(second.page, 'Mara');
      const reply = `Reply to ${original}`;
      await second.page.getByRole('textbox', { name: 'Write a reply', exact: true }).fill(reply);
      await second.page.getByRole('button', { name: 'Post reply', exact: true }).click();
      await expect(second.page.getByText(reply, { exact: true })).toBeVisible();
      const replyArticle = second.page
        .getByRole('article')
        .filter({ has: second.page.getByText(reply, { exact: true }) })
        .last();
      const replyId = await replyArticle.getAttribute('id');

      await first.page.reload();
      const rootAgain = first.page
        .getByRole('article')
        .filter({ has: first.page.getByText(edited, { exact: true }) })
        .last();
      await rootAgain.getByRole('button', { name: 'Delete', exact: true }).click();
      await first.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
      await expect(first.page.getByText('Comment deleted', { exact: true }).last()).toBeVisible();
      await expect(first.page.getByText(reply, { exact: true })).toBeVisible();
      await expect(first.page.getByText(edited, { exact: true })).toHaveCount(0);
      if (replyId) {
        await second.go(`${article}#${replyId}`);
        await expect(second.page.locator(`[id="${replyId}"]`)).toBeVisible();
      }

      const admin = await localBrowser(browser, 'admin');
      contexts.push(admin.context);
      await admin.go(article);
      const administeredReply = admin.page
        .getByRole('article')
        .filter({ has: admin.page.getByText(reply, { exact: true }) })
        .last();
      await administeredReply.getByRole('button', { name: 'Remove', exact: true }).click();
      await admin.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Remove', exact: true })
        .click();
      await expect(admin.page.getByText(reply, { exact: true })).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('a lost posting response is recovered once without losing a newer draft', async ({
    browser,
  }) => {
    const { context, page, go } = await localBrowser(browser, 'reader');
    try {
      await go(article);
      await expect(
        page.getByRole('textbox', { name: 'Write a comment', exact: true }),
      ).toBeVisible();
      const posted = `Lost response ${Date.now()}`;
      let lost = false;
      await page.route(`${api}/api/v1/comments/articles/${articleId}`, async (route) => {
        if (route.request().method() !== 'POST' || lost) return route.continue();
        lost = true;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      });
      await page.getByRole('textbox', { name: 'Write a comment', exact: true }).fill(posted);
      await page.getByRole('button', { name: 'Post comment', exact: true }).click();
      await expect(
        page.getByRole('alert').getByRole('button', { name: 'Check submission', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('textbox', { name: 'Write a comment', exact: true })
        .fill('A newer unsent thought');
      await page.getByRole('button', { name: 'Check submission', exact: true }).click();
      await expect(page.getByText(posted, { exact: true })).toHaveCount(1);
      await expect(page.getByRole('textbox', { name: 'Write a comment', exact: true })).toHaveValue(
        'A newer unsent thought',
      );
      const articleEmails = page.getByRole('checkbox', {
        name: 'Email me about all new or edited comments and replies on this article',
        exact: true,
      });
      if (await articleEmails.isChecked()) {
        await articleEmails.uncheck();
        await expect(page.getByText('Email choices saved', { exact: true })).toBeVisible();
      }
      await articleEmails.check();
      await expect(page.getByText('Email choices saved', { exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('checkbox', {
          name: 'Email me about all new or edited comments and replies on this article',
          exact: true,
        }),
      ).toBeChecked();
    } finally {
      await context.close();
    }
  });

  test('unfinished text stays with its article while reading another guide', async ({
    browser,
  }) => {
    const { context, page, go } = await localBrowser(browser, 'reader');
    try {
      await go(article);
      const comment = page.getByRole('textbox', { name: 'Write a comment', exact: true });
      await comment.fill('A thought to finish after reading another guide');
      await page.getByRole('link', { name: 'Read', exact: true }).first().click();
      await page
        .getByRole('link', { name: /Who has to report their money/ })
        .first()
        .click();
      await expect(comment).toHaveValue('');
      await page.getByRole('link', { name: 'Read', exact: true }).first().click();
      await page
        .getByRole('link', { name: /What the records name, and what they leave out/ })
        .first()
        .click();
      await expect(comment).toHaveValue('A thought to finish after reading another guide');
      await page
        .getByRole('region', { name: 'Reader comments', exact: true })
        .screenshot({ path: test.info().outputPath('comments-signed-in.png') });
    } finally {
      await context.close();
    }
  });

  test('an admin removal preserves open reply and edit drafts', async ({ browser }) => {
    const owner = await localBrowser(browser, 'reader');
    const reader = await localBrowser(browser, 'second');
    try {
      await owner.go(article);
      const original = `Removal recovery ${Date.now()}`;
      await owner.page
        .getByRole('textbox', { name: 'Write a comment', exact: true })
        .fill(original);
      await owner.page.getByRole('button', { name: 'Post comment', exact: true }).click();
      const posted = owner.page.getByRole('article').filter({ hasText: original }).last();
      await expect(posted).toBeVisible();
      const anchor = (await posted.getAttribute('id'))!;
      await posted.getByRole('button', { name: 'Edit', exact: true }).click();
      await posted.getByRole('textbox').fill('Keep my unfinished edit');

      await reader.go(`${article}#${anchor}`);
      await reader.page
        .locator(`[id="${anchor}"]`)
        .getByRole('button', { name: 'Reply', exact: true })
        .click();
      await reader.page
        .getByRole('textbox', { name: 'Write a reply', exact: true })
        .fill('Keep my unfinished reply');

      const headers = { Authorization: `Bearer ${accounts.admin.token}` };
      const settingsResponse = await owner.context.request.get(
        `${api}/api/v1/me/comments/settings?article_id=${articleId}`,
        { headers },
      );
      expect(settingsResponse.ok()).toBe(true);
      const { data: settings } = await settingsResponse.json();
      const removed = await owner.context.request.post(
        `${api}/api/v1/comments/articles/${articleId}/${anchor.slice('comment-'.length)}/remove`,
        {
          headers,
          data: {
            request_key: crypto.randomUUID(),
            expected_account_id: settings.account_id,
            expected_version: 1,
          },
        },
      );
      expect(removed.ok()).toBe(true);

      await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(
        owner.page.getByText('This comment is no longer available. Your draft is kept here.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        owner.page.getByRole('textbox', { name: 'Write a comment', exact: true }).last(),
      ).toHaveValue('Keep my unfinished edit');
      await expect(
        owner.page.getByRole('button', { name: 'Save changes', exact: true }),
      ).toHaveAttribute('aria-disabled', 'true');
      await reader.page.getByRole('button', { name: 'Post reply', exact: true }).click();
      await expect(
        reader.page.getByRole('alert').filter({
          hasText:
            'The comment you were replying to is no longer available. Your draft is kept here.',
        }),
      ).toBeVisible();
      await expect(
        reader.page.getByRole('textbox', { name: 'Write a reply', exact: true }),
      ).toHaveValue('Keep my unfinished reply');
      await expect(
        reader.page.getByRole('button', { name: 'Post reply', exact: true }),
      ).toHaveAttribute('aria-disabled', 'true');
      await reader.page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        reader.page.getByRole('heading', { name: 'Reader comments', exact: true }),
      ).toBeFocused();
    } finally {
      await Promise.all([owner.context.close(), reader.context.close()]);
    }
  });

  test('a stop link invalidated after opening uses the final invalid-link view', async ({
    browser,
  }) => {
    const { context, page, go } = await localBrowser(browser);
    try {
      await page.route(`${api}/api/v1/comments/email-stop/inspect`, (route) =>
        route.fulfill({
          json: {
            data: {
              article_id: articleId,
              article_title: 'Local recovery check',
              article_path: article,
              link_choice: 'replies',
              reply_emails: true,
              article_updates: true,
            },
          },
        }),
      );
      await page.route(`${api}/api/v1/comments/email-stop`, (route) =>
        route.fulfill({ status: 404, json: { detail: 'Invalid local test link' } }),
      );
      await go('/comment-emails#token=fake-local-recovery-only');
      await page.getByRole('button', { name: 'Stop reply emails', exact: true }).click();
      await expect(
        page.getByText('This email link could not be opened', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Stop reply emails', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'ask@alethical.com', exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
