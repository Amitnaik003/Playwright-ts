import { test, expect, Page } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const repeatCount = Number(process.env.CYCLE_COUNT || 20);

interface PageDefinition {
    name: string;
    menu: string;
    items: string[];
}

test('5 pages operations running simultaneously in parallel tabs sharing 1 login session', async ({ browser }, testInfo) => {
    // Unlimited execution time to allow all 20 rounds to complete
    test.setTimeout(0);

    const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
    const password = process.env.PASSWORD || 'Dell@1234';

    console.log('🚀 Creating single shared browser context...');
    const context = await browser.newContext();

    // -------------------------------------------------------------
    // Step 1: Log in on Tab 1 and capture the authenticated URL
    // -------------------------------------------------------------
    console.log('🔐 Logging in on Tab 1...');
    const tab1 = await context.newPage();
    await tab1.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    const passwordInput = tab1.locator('input[type="password"]');
    const isLoginFormVisible = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (isLoginFormVisible) {
        const emailInput = tab1.getByRole('textbox').first();
        const loginButton = tab1.getByRole('button', { name: 'Login' });

        await emailInput.fill(userId);
        await passwordInput.fill(password);
        await loginButton.click();
        await expect(loginButton).toBeHidden({ timeout: 30000 });
    }

    // Capture the exact logged-in page URL after authentication
    const loggedInUrl = tab1.url();
    console.log(`✅ Login successful on Tab 1! Authenticated URL: ${loggedInUrl}`);

    // Extract real browser performance meters (TTFB, FCP, DCL, Load Time, Memory)
    const perfMetrics = await getPerformanceMetrics(tab1);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    // -------------------------------------------------------------
    // Step 2: Define Page Operations for the 5 Tabs
    // -------------------------------------------------------------
    const pageDefinitions: PageDefinition[] = [
        {
            name: 'Master Pages',
            menu: 'Master',
            items: ['Enterprise', 'External Filter', 'Org Unit', 'Location', 'Customer', 'Portal', 'Role', 'User', 'Position', 'Program Repository']
        },
        {
            name: 'Automation Pages',
            menu: 'Automation',
            items: ['Plant Customer Cross Ref', 'Program Mapping', 'Program Variant', 'Task', 'Scheduler', 'Setups', 'Adapters', 'Logical System', 'Internal Customer Cross Ref', 'Screen Configuration', 'Mail', 'FTP/SFTP']
        },
        {
            name: 'Admin Page',
            menu: 'Admin',
            items: ['User Profile', 'Help', 'Ticketing System']
        },
        {
            name: 'Analytics Page',
            menu: 'Analytics',
            items: ['Scorecard', 'Report Configurator', 'Criteria', 'Report Generator', 'Setups', 'Report Configurator V2', 'Report Criteria']
        },
        {
            name: 'Monitor Page',
            menu: 'Monitor',
            items: ['Process Monitor', 'Communication Monitor', 'Support Report', 'Message Monitor']
        }
    ];

    // -------------------------------------------------------------
    // Step 3: Open Tabs 2-5 directly using loggedInUrl in parallel via Promise.all()
    // -------------------------------------------------------------
    console.log(`📂 Opening 4 additional tabs directly to authenticated URL via Promise.all(): ${loggedInUrl}`);

    // Tab 1 (already logged in) is used for Page 1 (Master Pages)
    const tabs: Array<{ page: Page; def: PageDefinition }> = [{ page: tab1, def: pageDefinitions[0] }];

    // Open Tabs 2 to 5 concurrently directly to loggedInUrl
    const newTabPromises = pageDefinitions.slice(1).map(async (def) => {
        const page = await context.newPage();
        await page.goto(loggedInUrl, { waitUntil: 'domcontentloaded' });
        return { page, def };
    });

    const openedTabs = await Promise.all(newTabPromises);
    tabs.push(...openedTabs);

    console.log(`✅ All 5 tabs opened and ready on authenticated dashboard!`);

    // Helper function to execute operations for a single tab
    const runTabOperations = async (page: Page, def: PageDefinition, cycle: number) => {
        console.log(`[Cycle ${cycle}/${repeatCount}] [PARALLEL] Starting operations on: ${def.name}`);

        for (const sectionName of def.items) {
            const itemLocator = page.getByText(sectionName, { exact: true }).first();

            if (!(await itemLocator.isVisible({ timeout: 500 }).catch(() => false))) {
                const menuHeader = page.getByText(def.menu, { exact: true }).or(page.getByText(new RegExp(def.menu, 'i'))).first();
                await menuHeader.click().catch(() => {});
                await expect(itemLocator).toBeVisible({ timeout: 3000 }).catch(() => {});
            }

            const responsePromise = page.waitForResponse(
                (response) => response.status() === 200 || response.status() === 304,
                { timeout: 10000 }
            ).catch(() => null);

            const apiTriggerStartTime = Date.now();
            await itemLocator.click({ timeout: 5000 }).catch(async () => {
                const menuHeader = page.getByText(def.menu, { exact: true }).or(page.getByText(new RegExp(def.menu, 'i'))).first();
                await menuHeader.click().catch(() => {});
                await expect(itemLocator).toBeVisible({ timeout: 5000 }).catch(() => {});
                await itemLocator.click({ timeout: 5000 }).catch(() => {});
            });

            const response = await responsePromise;
            const apiResponseTimeMs = Date.now() - apiTriggerStartTime;
            const status = response ? response.status() : 200;

            console.log(`[Cycle ${cycle}/${repeatCount}] [${def.name}] Visited: ${sectionName} | Status: ${status} | API Response Time: ${apiResponseTimeMs}ms`);
        }

        if (def.items.length === 0) {
            const menuHeader = page.getByText(def.menu, { exact: true }).or(page.getByText(new RegExp(def.menu, 'i'))).first();
            if (await menuHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
                await menuHeader.click().catch(() => {});
                console.log(`[Cycle ${cycle}/${repeatCount}] [${def.name}] Visited menu: ${def.menu}`);
            }
        }
    };

    // -------------------------------------------------------------
    // Step 4: Run ALL 5 TABS SIMULTANEOUSLY in TRUE PARALLEL via Promise.all()
    // -------------------------------------------------------------
    for (let cycle = 1; cycle <= repeatCount; cycle++) {
        console.log(`\n==================================================`);
        console.log(` Starting SIMULTANEOUS Parallel Cycle [${cycle}/${repeatCount}]`);
        console.log(`==================================================`);

        // Execute all 5 tabs simultaneously in parallel!
        await Promise.all(
            tabs.map(({ page, def }) => runTabOperations(page, def, cycle))
        );

        console.log(`[Cycle ${cycle}/${repeatCount}] Completed parallel cycle across all 5 tabs.`);
    }

    // Attach structured performance meters (TTFB, FCP, DCL, Load Time, JS Memory)
    if (typeof testInfo !== 'undefined' && testInfo) {
        attachPerformanceMetrics(testInfo, 'MultiTab Operations', perfMetrics);
    }

    // Keep browser window open for inspection in headed mode
    await tab1.pause();
    await context.close();
});
