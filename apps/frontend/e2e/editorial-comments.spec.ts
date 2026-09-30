import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Requires the task's disposable PostgreSQL API on 18261 and fake Supabase app
// on 19261. This suite refuses production and blocks every external request.
const api = 'http://127.0.0.1:18261';
const article = '/blog/guides/what-the-records-name';
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
      await go('/blog');
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

  test('comment layout and button type follow the approved desktop and phone design', async ({
    browser,
  }) => {
    const { context, page, go } = await localBrowser(browser);
    const root = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      article_id: articleId,
      author_id: accounts.reader.subject,
      name: 'Rowan',
      body: 'A local example comment',
      root_id: null,
      reply_to_id: null,
      reply_to_name: null,
      posted_at: '2026-09-26T14:00:00Z',
      edited_at: null,
      status: 'live',
      version: 1,
    };
    let populated = false;
    await page.route(`${api}/api/v1/comments/articles/${articleId}`, (route) =>
      route.fulfill({ json: { data: { items: populated ? [root] : [], next_cursor: null } } }),
    );
    try {
      await go(article);
      await expect(page.getByText('No comments yet')).toBeVisible();
      await expect(page.locator('.rc-list-status')).toHaveCount(0);
      await expect(page.locator('.rc-list .rc-empty')).toHaveCSS('margin-top', '0px');
      populated = true;
      await page.reload();
      await expect(page.getByText(root.body)).toBeVisible();
      await expect(page.getByText('Oldest first')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in to comment' })).toHaveCSS(
        'font-weight',
        '700',
      );
      await expect(page.getByRole('button', { name: 'Sign in to comment' })).toHaveCSS(
        'font-size',
        '16px',
      );
      const green = page.getByRole('button', { name: 'Sign in to comment' });
      await expect(green).toHaveCSS('line-height', '24px');
      await expect(green).toHaveCSS('background-color', 'rgb(46, 212, 126)');
      await green.hover();
      await expect(green).toHaveCSS('background-color', 'rgb(40, 191, 113)');
      await green.evaluate((button) => {
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-disabled', 'true');
      });
      await expect(green).toHaveCSS('background-color', 'rgb(158, 230, 191)');
      await green.evaluate((button) => {
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
      });
      await expect(page.getByRole('button', { name: 'Sign in to reply' })).toHaveCSS(
        'font-size',
        '15px',
      );
      await expect(page.getByRole('button', { name: 'Sign in to reply' })).toHaveCSS(
        'font-weight',
        '700',
      );
      await expect(page.getByRole('button', { name: 'Sign in to reply' })).toHaveCSS(
        'line-height',
        '22.5px',
      );
      expect(
        await page
          .locator('.rc-grid')
          .evaluate((grid) =>
            [...grid.children].map((child) =>
              child.classList.contains('rc-title')
                ? 'heading'
                : child.classList.contains('rc-discussion')
                  ? 'discussion'
                  : child.classList.contains('rc-rules')
                    ? 'rules'
                    : 'form',
            ),
          ),
      ).toEqual(['heading', 'discussion', 'rules', 'form']);

      for (const width of [1240, 900, 375]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.locator('.rc-grid').evaluate((grid) => {
          const box = (selector: string) => grid.querySelector(selector)!.getBoundingClientRect();
          const title = box('.rc-title');
          const discussion = box('.rc-list');
          const rules = box('.rc-rules');
          const form = box('.rc-form-card');
          return {
            titleTop: title.top,
            titleBottom: title.bottom,
            listTop: discussion.top,
            listBottom: discussion.bottom,
            rulesTop: rules.top,
            rulesBottom: rules.bottom,
            formTop: form.top,
            rulesPosition: getComputedStyle(grid.querySelector('.rc-rules')!).position,
          };
        });
        expect(layout.listTop - layout.titleBottom).toBeCloseTo(22, 0);
        if (width >= 1100) {
          expect(layout.rulesTop).toBeCloseTo(layout.titleTop, 0);
          expect(layout.formTop - layout.listBottom).toBeCloseTo(30, 0);
        } else {
          expect(layout.rulesTop - layout.listBottom).toBeCloseTo(30, 0);
          expect(layout.formTop - layout.rulesBottom).toBeCloseTo(22, 0);
        }
        expect(layout.rulesPosition).toBe('static');
      }
      await green.hover();
      await expect(green).toHaveCSS('background-color', 'rgb(46, 212, 126)');
      expect(
        await page
          .getByRole('button', { name: 'Sign in to comment' })
          .evaluate((button) => getComputedStyle(button).fontFamily.includes('Libre Franklin')),
      ).toBe(true);
    } finally {
      await context.close();
    }
    const signedIn = await localBrowser(browser, 'reader');
    try {
      const settingsResponse = await signedIn.context.request.get(
        `${api}/api/v1/me/comments/settings?article_id=${articleId}`,
        { headers: { Authorization: `Bearer ${accounts.reader.token}` } },
      );
      expect(settingsResponse.ok()).toBe(true);
      root.author_id = (await settingsResponse.json()).data.account_id;
      await signedIn.page.route(`${api}/api/v1/comments/articles/${articleId}`, (route) =>
        route.fulfill({ json: { data: { items: [root], next_cursor: null } } }),
      );
      await signedIn.go(article);
      const edit = signedIn.page.getByRole('button', { name: 'Edit', exact: true });
      await expect(edit).toBeVisible();
      const post = signedIn.page.getByRole('button', { name: 'Post comment', exact: true });
      await expect(post).toHaveCSS('font-family', /Libre Franklin/);
      await expect(post).toHaveCSS('font-size', '16px');
      await expect(post).toHaveCSS('font-weight', '700');
      await expect(post).toHaveCSS('line-height', '24px');
      await expect(edit).toHaveCSS('font-size', '15px');
      await expect(edit).toHaveCSS('font-weight', '700');
      await expect(edit).toHaveCSS('line-height', '22.5px');
      await edit.hover();
      await expect(edit).toHaveCSS('background-color', 'rgb(238, 243, 240)');
      await signedIn.page.getByRole('button', { name: 'Delete', exact: true }).click();
      const dark = signedIn.page.getByRole('dialog').getByRole('button', { name: 'Delete' });
      await expect(dark).toHaveCSS('font-size', '16px');
      await expect(dark).toHaveCSS('font-weight', '700');
      await expect(dark).toHaveCSS('font-family', /Libre Franklin/);
      await expect(dark).toHaveCSS('line-height', '24px');
      await expect(dark).toHaveCSS('background-color', 'rgb(17, 21, 15)');
      await dark.hover();
      await expect(dark).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await dark.evaluate((button) => {
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-disabled', 'true');
      });
      await expect(dark).toHaveCSS('background-color', 'rgb(74, 80, 75)');
      await dark.evaluate((button) => {
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
      });
      const cancel = signedIn.page.getByRole('dialog').getByRole('button', { name: 'Cancel' });
      await expect(cancel).toHaveCSS('font-weight', '700');
      await expect(cancel).toHaveCSS('font-size', '16px');
      await cancel.hover();
      await expect(cancel).toHaveCSS('background-color', 'rgb(247, 248, 250)');
      await signedIn.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await signedIn.context.close();
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
      await expect(owner.page.locator('.rc-list .rc-inline-card textarea')).toHaveValue(
        'Keep my unfinished edit',
      );
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
