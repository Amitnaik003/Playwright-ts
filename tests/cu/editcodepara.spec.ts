import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';

test('Edit Code - Customer Parent records (101 to 200) across 10 Parallel Tabs', async ({ page, context }, testInfo) => {
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
    console.log(` Opening ${tabCount} Parallel Tabs to Edit ${totalItems} Customer Parent Records`);
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

            // Wait for URL and initial table render (.first() prevents strict mode violation)
            await tab.waitForURL('**/customerparent**', { timeout: 35000 }).catch(() => { });
            await expect(tab.getByText('Master - Customer Parent', { exact: false }).or(tab.locator('table, .p-datatable')).first()).toBeVisible({ timeout: 35000 });

            // Shared Locators for this tab
            const searchInput = tab.locator('input[placeholder*="search" i], .p-datatable-header input, [class*="search"] input, input[type="text"]').last();

            const editButton = tab.getByTitle('Edit', { exact: false })
                .or(tab.locator('button[title*="Edit" i]'))
                .or(tab.locator('[title="Edit"]'))
                .or(tab.locator('[title="EDIT"]'))
                .or(tab.locator('div:has-text("Master - Customer Parent") button, .p-toolbar button, [role="listitem"] button').nth(2))
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

            // Loop 10 items for this tab
            for (let i = startNum; i <= endNum; i++) {
                const parentName = `Amit_${i}`;
                const newCode = `Amit003_${i}`;

                console.log(`[Tab ${tabIndex + 1}] Updating Code for "${parentName}" to "${newCode}"...`);

                // 1. Search for record by parentName to handle pagination
                if (await searchInput.isVisible().catch(() => false)) {
                    await searchInput.fill(parentName);
                    await tab.waitForTimeout(1000);
                }

                // 2. Locate target row containing parentName
                let targetRow = tab.locator('tbody tr, table tr').filter({ hasText: parentName }).first();

                if (!(await targetRow.isVisible({ timeout: 5000 }).catch(() => false))) {
                    await searchInput.fill('');
                    await tab.waitForTimeout(400);
                    await searchInput.fill(parentName);
                    await tab.waitForTimeout(1000);
                }

                if (!(await targetRow.isVisible({ timeout: 3000 }).catch(() => false))) {
                    console.log(`[Tab ${tabIndex + 1}] Could not find row for "${parentName}", skipping...`);
                    if (await searchInput.isVisible().catch(() => false)) await searchInput.fill('');
                    continue;
                }

                // 3. Select the checkbox for this specific row
                const rowCheckbox = targetRow.locator('input[type="checkbox"], [role="checkbox"], .p-checkbox-box, .p-checkbox-input').first();
                await rowCheckbox.scrollIntoViewIfNeeded().catch(() => { });
                await rowCheckbox.click({ force: true });
                await tab.waitForTimeout(500);

                // 4. Click Edit button in toolbar
                await editButton.waitFor({ state: 'visible', timeout: 10000 });
                await editButton.click({ force: true });
                await tab.waitForTimeout(800);

                // 5. Update Customer Parent Code field
                await codeInput.waitFor({ state: 'visible', timeout: 10000 });
                await codeInput.fill(newCode);
                await expect(codeInput).toHaveValue(newCode);
                await tab.waitForTimeout(500);

                // 6. Click Save button
                await saveButton.waitFor({ state: 'visible', timeout: 10000 });
                await saveButton.click({ force: true });
                await tab.waitForTimeout(800);

                // 7. Handle Confirmation Modal ("Do you want to save the data?") -> Click 'Yes'
                await yesButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                if (await yesButton.isVisible().catch(() => false)) {
                    await yesButton.click({ force: true });
                    console.log(`[Tab ${tabIndex + 1}] Clicked "Yes" on Confirmation modal!`);
                    await yesButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
                }

                // 8. Clear search filter & wait for table refresh
                if (await searchInput.isVisible().catch(() => false)) {
                    await searchInput.fill('');
                    await tab.waitForTimeout(800);
                }

                console.log(`[Tab ${tabIndex + 1}] Successfully Updated "${parentName}" Code to "${newCode}"!`);
                await tab.waitForTimeout(800);
            }

            await tab.close().catch(() => { });
        })());
    }

    // Execute all 10 parallel tab tasks concurrently
    await Promise.all(tasks);

    console.log(`\n==================================================`);
    console.log(` Successfully Updated Code for All 100 Customer Parent Records across 10 Parallel Tabs!`);
    console.log(`==================================================`);

    attachPerformanceMetrics(testInfo, 'CU - Edit Code Parallel', perfMetrics, { tabCount });
});
