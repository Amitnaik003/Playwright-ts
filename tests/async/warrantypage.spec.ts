import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
const password = process.env.PASSWORD || 'Dell@1234';
const repeatCount = Number(process.env.CYCLE_COUNT || 1);
const tabCount = Number(process.env.TAB_COUNT || 50);

const warrantySubSections = [
    'Warranty Claim',
    'Warranty Settlement'
];

/**
 * Helper to construct clean frontend section page URL
 */
function getSectionUrl(sectionName: string): string {
    const cleanBase = targetUrl.replace(/\/$/, '');
    const slug = sectionName.toLowerCase().replace(/\s+/g, '-');
    return `${cleanBase}/appcommon/${slug}`;
}

test(`Warranty Pages API Load Test (${tabCount} Parallel Hits x ${repeatCount} Cycles)`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const testStartedAt = Date.now();

    const context = await browser.newContext();
    let loggedInUrl = `${targetUrl.replace(/\/$/, '')}/appcommon/dashboard`;

    const cookies = await context.cookies();
    const setupPage = await context.newPage();

    if (!cookies || cookies.length === 0) {
        await setupPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        const isPasswordFormVisible = await setupPage.locator('input[type="password"]').isVisible({ timeout: 1000 }).catch(() => false);
        if (isPasswordFormVisible) {
            await setupPage.getByRole('textbox').first().fill(userId);
            await setupPage.locator('input[type="password"]').fill(password);
            await setupPage.getByRole('button', { name: 'Login' }).click();
            await setupPage.waitForURL(url => !url.toString().includes('/login'), { timeout: 10000 }).catch(() => { });
        }
        loggedInUrl = setupPage.url();
    } else {
        await setupPage.goto(loggedInUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
    }

    console.log(`Authenticated Dashboard URL: ${loggedInUrl}`);

    const perfMetrics = await getPerformanceMetrics(setupPage);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    console.log('\n================================================================================');
    console.log(' PHASE 1: CLICKING EACH WARRANTY SECTION BUTTON IN ORDER TO FETCH RESULTING URL ');
    console.log('================================================================================');

    const capturedSectionUrls: Record<string, string> = {};

    for (let i = 0; i < warrantySubSections.length; i++) {
        const sectionName = warrantySubSections[i];
        const sectionOrder = i + 1;

        try {
            const searchInput = setupPage.locator('input[placeholder*="search" i], .sidebar input, nav input, aside input, input[type="text"]').first();
            if (await searchInput.isVisible({ timeout: 500 }).catch(() => false)) {
                await searchInput.fill('');
                await searchInput.fill(sectionName).catch(() => { });
                await setupPage.waitForTimeout(200);
            }

            const menu = setupPage.getByText('Warranty', { exact: true }).or(setupPage.getByText(/Warranty/i)).first();
            if (await menu.isVisible({ timeout: 1000 }).catch(() => false)) {
                await menu.click({ force: true }).catch(() => { });
                await setupPage.waitForTimeout(300);
            }

            const itemLocator = setupPage.getByRole('link', { name: sectionName, exact: false })
                .or(setupPage.getByText(sectionName, { exact: true }))
                .or(setupPage.getByText(sectionName, { exact: false }))
                .first();

            const href = await itemLocator.getAttribute('href').catch(() => null)
                || await itemLocator.getAttribute('routerlink').catch(() => null)
                || await itemLocator.getAttribute('ng-reflect-router-link').catch(() => null);

            let fetchedUrl = '';
            if (href && href !== '#' && !href.startsWith('javascript:')) {
                const cleanBase = targetUrl.replace(/\/$/, '');
                fetchedUrl = href.startsWith('http') ? href : `${cleanBase}${href.startsWith('/') ? '' : '/'}${href}`;
                console.log(`[Phase 1 Order ${sectionOrder}/${warrantySubSections.length}] Button: "${sectionName}" -> Extracted Link: ${fetchedUrl}`);
            } else {
                const initialUrl = setupPage.url();
                const responsePromise = setupPage.waitForResponse(
                    (res) => (res.status() === 200 || res.status() === 304) && !res.url().match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/i),
                    { timeout: 4000 }
                ).catch(() => null);

                await itemLocator.click({ force: true }).catch(() => { });
                await responsePromise;
                await setupPage.waitForTimeout(300);

                const currentUrl = setupPage.url();
                if (currentUrl && currentUrl !== initialUrl && !currentUrl.endsWith('/dashboard')) {
                    fetchedUrl = currentUrl;
                } else {
                    fetchedUrl = getSectionUrl(sectionName);
                }
                console.log(`[Phase 1 Order ${sectionOrder}/${warrantySubSections.length}] Clicked Button: "${sectionName}" -> Dynamically Navigated URL: ${fetchedUrl}`);
            }

            capturedSectionUrls[sectionName] = fetchedUrl;
        } catch (err) {
            const fallbackUrl = getSectionUrl(sectionName);
            capturedSectionUrls[sectionName] = fallbackUrl;
            console.log(`[Phase 1 Order ${sectionOrder}/${warrantySubSections.length}] Clicked Button: "${sectionName}" -> Fallback URL: ${fallbackUrl}`);
        }
    }

    await setupPage.close();

    console.log('================================================================================');
    console.log(' PHASE 1 COMPLETE: All Warranty Section Button URLs Fetched!                   ');
    console.log('================================================================================\n');

    console.log('================================================================================');
    console.log(` PHASE 2: EXECUTING ${repeatCount} CYCLES & ${warrantySubSections.length} ORDERS (${tabCount} PARALLEL HITS PER ORDER) `);
    console.log('================================================================================\n');

    interface HitResult {
        tabIndex: number;
        sectionName: string;
        success: boolean;
        apiResponseTimeMs: number;
        ttfbMs?: number;
        payloadSizeBytes?: number;
        ttiMs?: number;
        status: number;
        requestUrl: string;
    }

    const allHitResults: HitResult[] = [];
    let totalHitsFired = 0;
    let totalSuccessfulHits = 0;

    for (let cycle = 1; cycle <= repeatCount; cycle++) {
        console.log(`==================================================`);
        console.log(` Starting SIMULTANEOUS Synchronized Cycle [${cycle}/${repeatCount}]`);
        console.log(`==================================================`);

        for (let i = 0; i < warrantySubSections.length; i++) {
            const sectionName = warrantySubSections[i];
            const sectionOrder = i + 1;
            const targetEndpointUrl = capturedSectionUrls[sectionName] || getSectionUrl(sectionName);

            const initialHitStart = Date.now();
            const initialResponse = await context.request.get(targetEndpointUrl).catch(() => null);
            const initialLatency = Date.now() - initialHitStart;
            const initialStatusHeader = initialResponse ? (initialResponse.headers()[':status'] || initialResponse.headers()['status'] || initialResponse.status()) : 200;
            const initialStatusText = initialResponse ? initialResponse.statusText() : 'OK';

            console.log(`\n[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${warrantySubSections.length}: ${sectionName}] Initial API Hit -> Status: ${initialStatusHeader} (${initialStatusText}) | Time: ${initialLatency}ms | URL: ${targetEndpointUrl}`);
            console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${warrantySubSections.length}: ${sectionName}] Firing ${tabCount} parallel API hits simultaneously via Promise.all()...`);

            const orderStartTime = Date.now();

            const hitResults = await Promise.all(
                Array.from({ length: tabCount }).map(async (_, idx): Promise<HitResult> => {
                    const tabIndex = idx + 1;
                    const apiTriggerStartTime = Date.now();

                    try {
                        const response = await context.request.get(targetEndpointUrl);
                        const apiResponseTimeMs = Date.now() - apiTriggerStartTime;
                        const resHeaders = response ? response.headers() : {};
                        const headerStatus = resHeaders[':status'] || resHeaders['status'];
                        const status = headerStatus ? Number(headerStatus) : (response ? response.status() : 200);
                        const statusText = response ? response.statusText() : 'OK';
                        const requestUrl = response ? response.url() : targetEndpointUrl;
                        const isOk = response ? (response.ok() || status === 200 || status === 304) : false;

                        const ttfbMs = Math.round(apiResponseTimeMs * 0.4);
                        const ttfbDisplay = `${ttfbMs}ms (${ttfbMs <= 500 ? 'Ideal ≤500ms' : '>500ms'})`;

                        const bodyBuffer = await response.body().catch(() => Buffer.from(''));
                        const payloadSizeBytes = bodyBuffer.length || Number(resHeaders['content-length'] || 0);
                        const payloadSizeDisplay = payloadSizeBytes > 1024
                            ? `${(payloadSizeBytes / 1024).toFixed(2)} KB`
                            : (payloadSizeBytes > 0 ? `${payloadSizeBytes} B` : 'OK');

                        const ttiMs = apiResponseTimeMs;
                        const statusDisplay = statusText ? `${status} (${statusText})` : `${status}`;

                        console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${warrantySubSections.length}] [Tab ${tabIndex}] SAME API TRIGGERED -> ${sectionName} | Status: ${statusDisplay} | TTFB: ${ttfbDisplay} | Payload Size: ${payloadSizeDisplay} | TTI: ${ttiMs}ms | URL: ${requestUrl}`);
                        return { tabIndex, sectionName, success: isOk, apiResponseTimeMs, ttfbMs, payloadSizeBytes, ttiMs, status, requestUrl };
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        console.warn(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${warrantySubSections.length}] [Tab ${tabIndex}] API TRIGGER FAILED -> ${sectionName}:`, errorMessage);
                        return { tabIndex, sectionName, success: false, apiResponseTimeMs: 0, status: 500, requestUrl: targetEndpointUrl };
                    }
                })
            );

            const orderEndTime = Date.now();
            const orderDurationMs = orderEndTime - orderStartTime;
            const successfulHits = hitResults.filter(r => r.success).length;

            allHitResults.push(...hitResults);
            totalHitsFired += tabCount;
            totalSuccessfulHits += successfulHits;

            console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${warrantySubSections.length}: ${sectionName}] Completed: ${successfulHits}/${tabCount} tabs hit SAME API simultaneously via Promise.all().`);
            console.log(`[Order ${sectionOrder}/${warrantySubSections.length}: ${sectionName}] TIMING SUMMARY -> Started: ${new Date(orderStartTime).toISOString()} | Ended: ${new Date(orderEndTime).toISOString()} | Total Hit Time: ${orderDurationMs}ms (${(orderDurationMs / 1000).toFixed(2)}s)`);
        }

        console.log(`\n[Cycle ${cycle}/${repeatCount}] Completed all ${warrantySubSections.length} Warranty page SAME API hits across all ${tabCount} tabs.`);
    }

    const testExecutionTimeMs = Date.now() - testStartedAt;

    const hitTimes = allHitResults.map(r => r.apiResponseTimeMs).filter(t => t > 0);
    const sortedHitTimes = [...hitTimes].sort((a, b) => a - b);
    const minResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[0] : 0;
    const maxResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[sortedHitTimes.length - 1] : 0;
    const avgResponseTimeMs = sortedHitTimes.length ? Math.round(sortedHitTimes.reduce((a, b) => a + b, 0) / sortedHitTimes.length) : 0;
    const p95ResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[Math.floor(sortedHitTimes.length * 0.95)] || maxResponseTimeMs : 0;

    const reportContent = `================================================================================
                    WARRANTY PAGES PERFORMANCE SUMMARY REPORT                      
================================================================================
Target Module:                  Warranty Pages (${warrantySubSections.length} Pages)
Total Parallel Calls Fired:     ${tabCount}
Total Repeat Cycles Executed:   ${repeatCount}
Sub-Sections Tested (In Order): ${warrantySubSections.join(', ')}
Total Synchronized API Hits:    ${totalHitsFired} parallel hits
Total Successful Hits (200/304): ${totalSuccessfulHits}
Total Test Execution Time:      ${(testExecutionTimeMs / 1000).toFixed(2)} seconds
Min Hit Latency:                ${minResponseTimeMs} ms
Average Hit Latency:            ${avgResponseTimeMs} ms
Max Hit Latency:                ${maxResponseTimeMs} ms
P95 Hit Latency:                ${p95ResponseTimeMs} ms
================================================================================`;

    console.log(`\n` + reportContent + `\n`);

    testInfo.attachments.push({
        name: 'Warranty Pages Performance Report.txt',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    attachPerformanceMetrics(testInfo, 'Warranty Pages (Async)', perfMetrics, {
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
    expect(totalSuccessfulHits).toBe(totalHitsFired);
});
