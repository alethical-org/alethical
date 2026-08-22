import { chromium, expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

const MARKER = 'data-alethical-browser-fill';
const TEST_ADDRESS = {
  fields: [
    { name: 'NAME_FULL', value: 'Alethical Browser Check' },
    { name: 'EMAIL_ADDRESS', value: 'autofill-check@example.invalid' },
    { name: 'PHONE_HOME_WHOLE_NUMBER', value: '612-555-0100' },
    { name: 'ADDRESS_HOME_LINE1', value: '100 Test Avenue' },
    { name: 'ADDRESS_HOME_CITY', value: 'Minneapolis' },
    { name: 'ADDRESS_HOME_STATE', value: 'MN' },
    { name: 'ADDRESS_HOME_ZIP', value: '55401' },
    { name: 'ADDRESS_HOME_COUNTRY', value: 'US' },
  ],
};

async function triggerBrowserFill(page: Page, session: CDPSession, selector: string) {
  await expect(page.locator(selector)).toBeVisible();
  const { root } = (await session.send('DOM.getDocument', { depth: 0 })) as {
    root: { nodeId: number };
  };
  const { nodeId } = (await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  })) as { nodeId: number };
  const { node } = (await session.send('DOM.describeNode', { nodeId })) as {
    node: { backendNodeId: number };
  };
  const { frameTree } = (await session.send('Page.getFrameTree')) as {
    frameTree: { frame: { id: string } };
  };
  let fillEventReceived = false;
  session.once('Autofill.addressFormFilled', () => {
    fillEventReceived = true;
  });

  await session.send('Autofill.trigger', {
    fieldId: node.backendNodeId,
    frameId: frameTree.frame.id,
    address: TEST_ADDRESS,
  });
  await expect.poll(() => fillEventReceived).toBe(true);
}

async function expectBrowserFillAppearance(field: Locator) {
  await field.hover();
  const appearance = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      filled: element.matches(':autofill') || element.matches(':-webkit-autofill'),
      boxShadow: style.boxShadow,
      webkitBoxShadow: style.getPropertyValue('-webkit-box-shadow'),
      webkitTextFillColor: style.getPropertyValue('-webkit-text-fill-color'),
      caretColor: style.caretColor,
    };
  });

  expect(appearance.filled).toBe(true);
  expect(`${appearance.boxShadow} ${appearance.webkitBoxShadow}`).toContain('rgb(255, 255, 255)');
  expect(appearance.webkitTextFillColor).toBe('rgb(17, 21, 15)');
  expect(appearance.caretColor).toBe('rgb(17, 21, 15)');

  await field.focus();
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const input = getComputedStyle(element);
        const shell = getComputedStyle(element.parentElement!);
        return {
          borderColor: shell.borderColor,
          ring: shell.boxShadow,
          outlineStyle: input.outlineStyle,
        };
      }),
    )
    .toEqual({
      borderColor: 'rgb(91, 48, 214)',
      ring: 'rgba(91, 48, 214, 0.22) 0px 0px 0px 3px',
      outlineStyle: 'none',
    });

  await field.evaluate((element) => (element as HTMLElement).blur());
  await expect
    .poll(() => field.evaluate((element) => getComputedStyle(element.parentElement!).boxShadow))
    .toBe('none');
}

test('only the approved address and Contact us fields carry browser-fill markers', async ({
  page,
}) => {
  await page.goto('/find-my-legislator');
  const address = page.getByRole('combobox', { name: 'Full Minnesota street address' });
  await expect(address).toHaveAttribute(MARKER, 'true');
  await expect(address).toHaveAttribute('autocomplete', 'street-address');

  await page.goto('/about/contact');
  const marked = page.locator(`input[${MARKER}="true"]`);
  await expect(marked.filter({ visible: true })).toHaveCount(3);
  for (const [id, autocomplete] of [
    ['contact-name', 'name'],
    ['contact-email', 'email'],
    ['contact-phone', 'tel'],
  ] as const) {
    const field = page.locator(`#${id}`);
    await expect(field).toHaveAttribute(MARKER, 'true');
    await expect(field).toHaveAttribute('autocomplete', autocomplete);
  }
  await expect(page.locator('#contact-subject')).not.toHaveAttribute(MARKER, 'true');
  await expect(page.locator('#contact-subject')).toHaveAttribute('autocomplete', 'off');
  await expect(page.locator('#contact-message')).not.toHaveAttribute(MARKER, 'true');
  await expect(page.locator('#contact-message')).toHaveAttribute('autocomplete', 'off');
});

test('Chrome applies the approved colors in a real browser-filled state', async ({
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chrome DevTools provides the test-only fill command');

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:19006';
    const session = await context.newCDPSession(page);
    await session.send('Autofill.enable');

    await page.goto(new URL('/', baseURL).href);
    const homeAddress = 'input[aria-label="Full street address"]';
    await triggerBrowserFill(page, session, homeAddress);
    await expectBrowserFillAppearance(page.locator(homeAddress));

    await page.goto(new URL('/find-my-legislator', baseURL).href);
    const finderAddress = 'input[aria-label="Full Minnesota street address"]';
    await triggerBrowserFill(page, session, finderAddress);
    await expectBrowserFillAppearance(page.locator(finderAddress));

    await page.goto(new URL('/about/contact', baseURL).href);
    await triggerBrowserFill(page, session, '#contact-email');
    for (const selector of ['#contact-name', '#contact-email', '#contact-phone']) {
      await expectBrowserFillAppearance(page.locator(selector));
    }
  } finally {
    await browser.close();
  }
});
