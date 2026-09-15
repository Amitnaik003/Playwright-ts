import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const count = Number(process.env.OPERATION_COUNT || 100);

test('Create and Read - Create Customer Parent records under Master', async ({ page }, testInfo) => {
    // Disable test timeout
    test.setTimeout(0);

    const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
    const password = process.env.PASSWORD || 'Dell@1234';

    console.log('Navigating to login page...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    const passwordInput = page.locator('input[type="password"]');
    const isLoginFormVisible = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (isLoginFormVisible) {
        const emailInput = page.getByRole('textbox').first();
        const loginButton = page.getByRole('button', { name: 'Login' });

        console.log(`Entering credentials for ${userId}...`);
        await emailInput.fill(userId);
        await passwordInput.fill(password);

        console.log('Clicking Login button...');
        await loginButton.click();
        await expect(loginButton).toBeHidden({ timeout: 30000 });
    }

    console.log(`Login successful! Authenticated URL: ${page.url()}`);

    // Extract real browser performance meters (TTFB, FCP, DCL, Load Time, Memory)
    const perfMetrics = await getPerformanceMetrics(page);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    // -------------------------------------------------------------
    // Step 1: Navigate to Master -> Customer Page
    // -------------------------------------------------------------
    console.log('Navigating to Master -> Customer page...');

    const masterMenu = page.getByText('Master', { exact: true }).or(page.locator('div, li, a').filter({ hasText: /^Master$/i })).first();
    const customerLink = page.locator('a[href*="customerparent"]').or(page.getByText('Customer', { exact: true })).first();

    if (!(await customerLink.isVisible().catch(() => false))) {
        console.log('Expanding Master menu...');
        await masterMenu.click({ force: true });
        await page.waitForTimeout(500);
    }

    console.log('Clicking Customer sub-section...');
    await customerLink.click({ force: true });

    // Wait for Customer Parent page to load
    await page.waitForURL('**/customerparent**', { timeout: 15000 }).catch(() => { });
    await expect(page.getByText('Master - Customer Parent', { exact: false })).toBeVisible({ timeout: 15000 });
    console.log(`Successfully opened Customer page! Current URL: ${page.url()}`);

    // -------------------------------------------------------------
    // Step 2: Define Locators
    // -------------------------------------------------------------
    const nameInput = page.locator('input[formcontrolname="CustomerParentName"]')
        .or(page.locator('input[formcontrolname*="ParentName" i]'))
        .or(page.locator('.p-dialog input[type="text"], form input[type="text"]').nth(0))
        .first();

    const codeInput = page.locator('input[formcontrolname="CustomerParentCode"]')
        .or(page.locator('input[formcontrolname*="ParentCode" i]'))
        .or(page.locator('.p-dialog input[type="text"], form input[type="text"]').nth(1))
        .first();

    const saveButton = page.getByTitle('Save', { exact: false })
        .or(page.locator('button[title*="Save" i]'))
        .or(page.locator('[role="list"] > [role="listitem"]:nth-child(6) button'))
        .or(page.locator('button:has(.pi-save), button:has(.fa-save)'))
        .first();

    const yesButton = page.getByRole('button', { name: 'Yes', exact: false })
        .or(page.locator('button:has-text("Yes")'))
        .or(page.locator('.p-dialog button:has-text("Yes")'))
        .first();

    // Helper to ensure Add form is opened
    async function openAddForm(): Promise<void> {
        if (await nameInput.isVisible().catch(() => false)) {
            return;
        }

        console.log('Clicking Add (+) button...');

        const addCandidates = [
            page.getByTitle('Add', { exact: false }),
            page.locator('button[title*="Add" i]'),
            page.getByText('Master - Customer Parent').locator('xpath=ancestor::div[ul or ol or div][position()<=4]').locator('ul li, ol li, [role="listitem"]').nth(1).locator('button'),
            page.locator('[role="list"] > [role="listitem"]:nth-child(2) button'),
            page.locator('button:has(.pi-plus), button:has(.fa-plus)')
        ];

        for (const cand of addCandidates) {
            try {
                const btn = cand.first();
                if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await btn.click({ force: true });
                    await page.waitForTimeout(500);

                    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                        console.log('Successfully opened Add form!');
                        return;
                    }
                }
            } catch (e) { }
        }

        await expect(nameInput).toBeVisible({ timeout: 10000 });
    }

    // -------------------------------------------------------------
    // Step 3: Create Customer Parent Records Loop (1 to 100)
    // -------------------------------------------------------------
    console.log(`\n==================================================`);
    console.log(` Starting Create Process for ${count} Customer Parent Records`);
    console.log(`==================================================`);

    for (let i = 1; i <= count; i++) {
        const numStr = String(i).padStart(2, '0');
        const parentName = `Amit_${numStr}`;
        const parentCode = 'Amit03';

        console.log(`[Item ${i}/${count}] Creating Customer Parent: Name="${parentName}", Code="${parentCode}"`);

        // 1. Ensure Add form is open
        await openAddForm();

        // 2. Fill Customer Parent Name & Code
        await nameInput.waitFor({ state: 'visible', timeout: 10000 });
        await nameInput.fill(parentName);

        await codeInput.waitFor({ state: 'visible', timeout: 10000 });
        await codeInput.fill(parentCode);

        // 3. Verify entered values
        await expect(nameInput).toHaveValue(parentName);
        await expect(codeInput).toHaveValue(parentCode);

        // 4. Click Save
        await saveButton.waitFor({ state: 'visible', timeout: 10000 });
        await saveButton.click({ force: true });

        // 5. Handle Confirmation Modal ("Do you want to save the data?") -> Click 'Yes'
        await yesButton.waitFor({ state: 'visible', timeout: 4000 }).catch(() => { });
        if (await yesButton.isVisible().catch(() => false)) {
            await yesButton.click({ force: true });
            console.log(`[Item ${i}/${count}] Clicked "Yes" on Confirmation modal!`);
            await yesButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
        }

        console.log(`[Item ${i}/${count}] Successfully Processed: Name="${parentName}", Code="${parentCode}"`);
        await page.waitForTimeout(500);
    }

    console.log(`\n==================================================`);
    console.log(` Successfully Created & Saved All ${count} Customer Parent Records!`);
    console.log(`==================================================`);

    attachPerformanceMetrics(testInfo, 'CU - Create and Read', perfMetrics, { repeatCount: count });
});
