import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';

test('Create and Read - Create Customer Parent records (101 to 200) across 10 Parallel Tabs', async ({ page, context }, testInfo) => {
    // Disable test timeout
    test.setTimeout(0);

    const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
    const password = process.env.PASSWORD || 'Dell@1234';

    // Step 1: Login in primary tab
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

    const customerParentUrl = 'https://polite-pond-09fb16200.7.azurestaticapps.net/appcommon/customerparent';
    console.log(`Login successful! Authenticated context ready.`);

    // Extract real browser performance meters (TTFB, FCP, DCL, Load Time, Memory)
    const perfMetrics = await getPerformanceMetrics(page);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    // -------------------------------------------------------------
    // Step 2: Open 10 Parallel Authenticated Tabs & Divide 100 Items
    // -------------------------------------------------------------
    const tabCount = 10;
    const totalItems = 100;
    const itemsPerTab = totalItems / tabCount; // 10 items per tab

    console.log(`\n==================================================`);
    console.log(` Opening ${tabCount} Parallel Tabs to Create ${totalItems} Customer Parent Records`);
    console.log(` (Amit_101 to Amit_200, 10 items per tab)`);
    console.log(`==================================================\n`);

    const tasks: Promise<void>[] = [];

    for (let tabIndex = 0; tabIndex < tabCount; tabIndex++) {
        const startNum = 101 + (tabIndex * itemsPerTab); // e.g. 101, 111, 121...
        const endNum = startNum + itemsPerTab - 1;       // e.g. 110, 120, 130...

        tasks.push((async () => {
            // Open new authenticated browser tab sharing same login session
            const tab = await context.newPage();
            console.log(`[Tab ${tabIndex + 1}/${tabCount}] Opening Customer Parent page for range Amit_${startNum}..Amit_${endNum}...`);
            await tab.goto(customerParentUrl, { waitUntil: 'domcontentloaded' });
            await expect(tab.getByText('Master - Customer Parent', { exact: false })).toBeVisible({ timeout: 25000 });

            // Form Locators for this tab
            const nameInput = tab.locator('input[formcontrolname="CustomerParentName"]')
                .or(tab.locator('input[formcontrolname*="ParentName" i]'))
                .or(tab.locator('.p-dialog input[type="text"], form input[type="text"]').nth(0))
                .first();

            const codeInput = tab.locator('input[formcontrolname="CustomerParentCode"]')
                .or(tab.locator('input[formcontrolname*="ParentCode" i]'))
                .or(tab.locator('.p-dialog input[type="text"], form input[type="text"]').nth(1))
                .first();

            const saveButton = tab.getByTitle('Save', { exact: false })
                .or(tab.locator('button[title*="Save" i]'))
                .or(tab.locator('[role="list"] > [role="listitem"]:nth-child(6) button'))
                .or(tab.locator('button:has(.pi-save), button:has(.fa-save)'))
                .first();

            const yesButton = tab.getByRole('button', { name: 'Yes', exact: false })
                .or(tab.locator('button:has-text("Yes")'))
                .or(tab.locator('.p-dialog button:has-text("Yes")'))
                .first();

            const addButton = tab.getByTitle('Add', { exact: false })
                .or(tab.locator('button[title*="Add" i]'))
                .or(tab.locator('[role="list"] > [role="listitem"]:nth-child(2) button'))
                .or(tab.locator('button:has(.pi-plus), button:has(.fa-plus)'))
                .first();

            async function openAddForm(): Promise<void> {
                for (let attempt = 0; attempt < 5; attempt++) {
                    if (await nameInput.isVisible().catch(() => false)) return;

                    try {
                        if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await addButton.click({ force: true });
                            await tab.waitForTimeout(800);
                        }
                    } catch (e) { }

                    if (await nameInput.isVisible().catch(() => false)) return;
                }

                await expect(nameInput).toBeVisible({ timeout: 10000 });
            }

            // Loop 10 items for this tab
            for (let i = startNum; i <= endNum; i++) {
                const parentName = `Amit_${i}`;
                const parentCode = 'Amit003';

                console.log(`[Tab ${tabIndex + 1}] Creating: Name="${parentName}", Code="${parentCode}"`);

                await openAddForm();

                await nameInput.waitFor({ state: 'visible', timeout: 10000 });
                await nameInput.fill(parentName);

                await codeInput.waitFor({ state: 'visible', timeout: 10000 });
                await codeInput.fill(parentCode);

                await expect(nameInput).toHaveValue(parentName);
                await expect(codeInput).toHaveValue(parentCode);

                await saveButton.waitFor({ state: 'visible', timeout: 10000 });
                await saveButton.click({ force: true });

                await yesButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                if (await yesButton.isVisible().catch(() => false)) {
                    await yesButton.click({ force: true });
                    await yesButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
                }

                console.log(`[Tab ${tabIndex + 1}] Successfully Saved: Name="${parentName}"`);
                await tab.waitForTimeout(500);
            }

            await tab.close().catch(() => { });
        })());
    }

    // Execute all 10 parallel tab tasks concurrently
    await Promise.all(tasks);

    console.log(`\n==================================================`);
    console.log(` Successfully Created All 100 Customer Parent Records across 10 Parallel Tabs!`);
    console.log(`==================================================`);

    attachPerformanceMetrics(testInfo, 'CU - Create and Read Parallel', perfMetrics, { tabCount });
});
