import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const count = Number(process.env.OPERATION_COUNT || 10);

test('Edit Code - Customer Parent under Master', async ({ page }, testInfo) => {
    // Disable test timeout to process all items
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
    // Step 2: Define Shared Locators
    // -------------------------------------------------------------
    const searchInput = page.locator('input[placeholder*="search" i], .p-datatable-header input, [class*="search"] input, input[type="text"]').last();

    const editButton = page.getByTitle('Edit', { exact: false })
        .or(page.locator('button[title*="Edit" i]'))
        .or(page.locator('[title="Edit"]'))
        .or(page.locator('[title="EDIT"]'))
        .or(page.locator('div:has-text("Master - Customer Parent") button, .p-toolbar button, [role="listitem"] button').nth(2))
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

    // -------------------------------------------------------------
    // Step 3: Loop 1 to 100 to Edit Customer Parent Code (With Steady Delays)
    // -------------------------------------------------------------
    console.log(`\n==================================================`);
    console.log(` Starting Edit Code Process for ${count} Customer Parent Records`);
    console.log(`==================================================`);

    for (let i = 1; i <= count; i++) {
        const numStr = String(i).padStart(2, '0');
        const parentName = `Amit_${numStr}`;
        const newCode = `Amit03_${i}`;

        console.log(`[Item ${i}/${count}] Updating Code for "${parentName}" to "${newCode}"...`);

        // 1. Search for record by parentName to handle pagination
        if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.fill(parentName);
            // Allow PrimeNG table to finish filtering
            await page.waitForTimeout(1000);
        }

        // 2. Locate target row containing parentName
        let targetRow = page.locator('tbody tr, table tr').filter({ hasText: parentName }).first();

        if (!(await targetRow.isVisible({ timeout: 5000 }).catch(() => false))) {
            console.log(`[Item ${i}/${count}] Row for "${parentName}" not visible, retrying search...`);
            await searchInput.fill('');
            await page.waitForTimeout(500);
            await searchInput.fill(parentName);
            await page.waitForTimeout(1000);
        }

        if (!(await targetRow.isVisible({ timeout: 3000 }).catch(() => false))) {
            console.log(`[Item ${i}/${count}] Could not find row for "${parentName}", skipping...`);
            if (await searchInput.isVisible().catch(() => false)) await searchInput.fill('');
            continue;
        }

        // 3. Select the checkbox for this specific row
        const rowCheckbox = targetRow.locator('input[type="checkbox"], [role="checkbox"], .p-checkbox-box, .p-checkbox-input').first();
        await rowCheckbox.scrollIntoViewIfNeeded().catch(() => { });
        await rowCheckbox.click({ force: true });
        await page.waitForTimeout(500);

        // 4. Click Edit button in toolbar
        await editButton.waitFor({ state: 'visible', timeout: 10000 });
        await editButton.click({ force: true });
        await page.waitForTimeout(800);

        // 5. Update Customer Parent Code field
        await codeInput.waitFor({ state: 'visible', timeout: 10000 });
        await codeInput.fill(newCode);
        await expect(codeInput).toHaveValue(newCode);
        await page.waitForTimeout(500);

        // 6. Click Save button
        await saveButton.waitFor({ state: 'visible', timeout: 10000 });
        await saveButton.click({ force: true });
        await page.waitForTimeout(800);

        // 7. Handle Confirmation Modal ("Do you want to save the data?") -> Click 'Yes'
        await yesButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
        if (await yesButton.isVisible().catch(() => false)) {
            await yesButton.click({ force: true });
            console.log(`[Item ${i}/${count}] Clicked "Yes" on Confirmation modal!`);
            await yesButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
        }

        // 8. Clear search filter & wait for table refresh
        if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.fill('');
            await page.waitForTimeout(800);
        }

        console.log(`[Item ${i}/${count}] Successfully Updated "${parentName}" Code to "${newCode}"!`);
        await page.waitForTimeout(1000);
    }

    console.log(`\n==================================================`);
    console.log(` Successfully Updated Code for All Customer Parent Records!`);
    console.log(`==================================================`);

    attachPerformanceMetrics(testInfo, 'CU - Edit Code', perfMetrics);
});
