import { test } from '@playwright/test';

test('Debug Monitor Menu DOM', async ({ page }) => {
    test.setTimeout(60000);
    const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
    const password = process.env.PASSWORD || 'Dell@1234';
    const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';

    console.log('Navigating to login...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    const passwordInput = page.locator('input[type="password"]');
    const isLoginFormVisible = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (isLoginFormVisible) {
        await page.getByRole('textbox').first().fill(userId);
        await passwordInput.fill(password);
        await page.getByRole('button', { name: 'Login' }).click();
        await page.waitForTimeout(3000);
    }

    console.log('Current URL after login:', page.url());

    // Locate Monitor menu header
    const monitorMenu = page.getByText('Monitor', { exact: true }).or(page.getByText(/^Monitor$/i)).first();
    console.log('Monitor menu visible:', await monitorMenu.isVisible());
    await monitorMenu.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);

    // Get all visible text items in sidebar / navigation
    const allText = await page.locator('nav, aside, .sidebar, .menu, body').allInnerTexts();
    console.log('=== ALL TEXT IN SIDEBAR / BODY ===');
    console.log(allText.join('\n---\n'));

    // Check specific locator visibility
    for (const name of ['Process Monitor', 'Communication Monitor', 'Support Report', 'Message Monitor', 'Support', 'Report']) {
        const loc = page.getByText(name, { exact: true });
        const isVis = await loc.isVisible().catch(() => false);
        const count = await loc.count().catch(() => 0);
        console.log(`Locator exact "${name}": visible=${isVis}, count=${count}`);
    }
});
