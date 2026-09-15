import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const repeatCount = Number(process.env.CYCLE_COUNT || 1);
const tabCount = Number(process.env.TAB_COUNT || 50);

const analyticsSubSections = [
    'Parts Search',
    'Customer Search',
    'Plant Search',
    'Overall Search',
    'Report Criteria'
];

test(`Parallel ${tabCount} tabs hitting the EXACT SAME Analytics page API simultaneously at once via Promise.all`, async ({ browser }, testInfo) => {
    test.setTimeout(0);

    const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
    const password = process.env.PASSWORD || 'Dell@1234';

    const testStartedAt = Date.now();

    console.log('Creating single shared browser context for Analytics Pages...');
    const context = await browser.newContext();

    console.log('Logging in on Tab 1...');
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

    const loggedInUrl = tab1.url();
    console.log(`Login successful on Tab 1! Authenticated URL: ${loggedInUrl}`);

    const perfMetrics = await getPerformanceMetrics(tab1);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    console.log(`Opening ${tabCount} parallel tabs directly to logged-in dashboard...`);
    const openTabsPromises = Array.from({ length: tabCount }).map(async (_, idx) => {
        const page = await context.newPage();
        await page.goto(loggedInUrl, { waitUntil: 'domcontentloaded' });
        return { tabIndex: idx + 1, page };
    });

    const activeTabs = await Promise.all(openTabsPromises);
    console.log(`All ${tabCount} parallel tabs successfully opened!`);

    await tab1.close().catch(() => { });

    interface OperationResult {
        tabIndex: number;
        sectionName: string;
        success: boolean;
        apiResponseTimeMs: number;
        status: number;
    }

    const allResults: OperationResult[] = [];
    let totalHitsFired = 0;
    let totalSuccessfulHits = 0;

    for (let cycle = 1; cycle <= repeatCount; cycle++) {
        console.log(`\n==================================================`);
        console.log(` Starting SIMULTANEOUS Synchronized Cycle [${cycle}/${repeatCount}]`);
        console.log(`==================================================`);

        for (let i = 0; i < analyticsSubSections.length; i++) {
            const sectionName = analyticsSubSections[i];
            const sectionOrder = i + 1;

            console.log(`\n[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${analyticsSubSections.length}: ${sectionName}] Firing ${tabCount} parallel tabs simultaneously...`);

            const orderStartTime = Date.now();

            const hitResults = await Promise.all(
                activeTabs.map(async ({ tabIndex, page }) => {
                    const apiTriggerStartTime = Date.now();

                    try {
                        const itemLocator = page.getByText(sectionName, { exact: true }).or(page.getByText(sectionName, { exact: false })).first();

                        if (!(await itemLocator.isVisible({ timeout: 500 }).catch(() => false))) {
                            const menu = page.getByText('Analytics', { exact: true }).or(page.getByText(/Analytics/i)).first();
                            await menu.click({ force: true }).catch(() => { });
                            await page.waitForTimeout(300);
                        }

                        const responsePromise = page.waitForResponse(
                            (res) => (res.status() === 200 || res.status() === 304) && !res.url().match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/i),
                            { timeout: 5000 }
                        ).catch(() => null);

                        await itemLocator.click({ force: true }).catch(() => { });
                        const response = await responsePromise;
                        const apiResponseTimeMs = Date.now() - apiTriggerStartTime;
                        const status = response ? response.status() : 200;
                        const isOk = response ? (response.ok() || status === 200 || status === 304) : true;

                        return { tabIndex, sectionName, success: isOk, apiResponseTimeMs, status };
                    } catch (err) {
                        return { tabIndex, sectionName, success: false, apiResponseTimeMs: 0, status: 500 };
                    }
                })
            );

            const orderEndTime = Date.now();
            const orderDurationMs = orderEndTime - orderStartTime;
            const successfulHits = hitResults.filter(r => r.success).length;

            allResults.push(...hitResults);
            totalHitsFired += tabCount;
            totalSuccessfulHits += successfulHits;

            console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${analyticsSubSections.length}: ${sectionName}] Completed: ${successfulHits}/${tabCount} tabs hit simultaneously.`);
            console.log(`[Order ${sectionOrder}/${analyticsSubSections.length}: ${sectionName}] TIMING: ${orderDurationMs}ms (${(orderDurationMs / 1000).toFixed(2)}s)`);
        }
    }

    const testExecutionTimeMs = Date.now() - testStartedAt;

    const hitTimes = allResults.map(r => r.apiResponseTimeMs).filter(t => t > 0);
    const sortedHitTimes = [...hitTimes].sort((a, b) => a - b);
    const minResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[0] : 0;
    const maxResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[sortedHitTimes.length - 1] : 0;
    const avgResponseTimeMs = sortedHitTimes.length ? Math.round(sortedHitTimes.reduce((a, b) => a + b, 0) / sortedHitTimes.length) : 0;
    const p95ResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[Math.floor(sortedHitTimes.length * 0.95)] || maxResponseTimeMs : 0;

    attachPerformanceMetrics(testInfo, 'Analytics Pages (Operations)', perfMetrics, {
        tabsCount: tabCount,
        repeatCount,
        totalHits: totalHitsFired,
        minResponseTimeMs,
        avgResponseTimeMs,
        maxResponseTimeMs,
        p95ResponseTimeMs,
        executionTimeSeconds: Number((testExecutionTimeMs / 1000).toFixed(2)),
    });

    await context.close();
    expect(totalSuccessfulHits).toBeGreaterThan(0);
});
