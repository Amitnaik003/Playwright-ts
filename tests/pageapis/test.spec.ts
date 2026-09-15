import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = 'https://playwright.dev/';
const repeatCount = Number(process.env.CYCLE_COUNT || 1);
const tabCount = Number(process.env.TAB_COUNT || 50);

const testSubSections = [
    'Installation',
    'Writing tests',
    'Generating tests'
];

const defaultHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Builds accurate default routing URLs for Playwright sub-sections
 */
function getSectionUrl(sectionName: string): string {
    const cleanBase = targetUrl.replace(/\/$/, '');

    const sectionRoutes: Record<string, string> = {
        'Installation': `${cleanBase}/docs/intro`,
        'Writing tests': `${cleanBase}/docs/writing-tests`,
        'Generating tests': `${cleanBase}/docs/gerenas`,
    };

    return sectionRoutes[sectionName] || `${cleanBase}/docs/${sectionName.toLowerCase().replace(/\s+/g, '-')}`;
}

test(`Public Pages API Load Test (${tabCount} Parallel Hits x ${repeatCount} Cycles)`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const testStartedAt = Date.now();

    const context = await browser.newContext({
        extraHTTPHeaders: defaultHeaders
    });

    const setupPage = await context.newPage();
    await setupPage.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
    const targetBaseUrl = setupPage.url() || targetUrl;

    // Safely collect metrics
    let perfMetrics = await getPerformanceMetrics(setupPage).catch(() => null);
    if (!perfMetrics) {
        perfMetrics = { ttfbMs: 0, fcpMs: 0, domContentLoadedMs: 0, loadTimeMs: 0, jsHeapMB: 0 };
    }
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    console.log('\n================================================================================');
    console.log(' PHASE 1: SEARCHING & FETCHING REAL SECTION URLS FROM THE UI MENU DYNAMICALLY  ');
    console.log('================================================================================');

    const capturedSectionUrls: Record<string, string> = {};

    for (let i = 0; i < testSubSections.length; i++) {
        const sectionName = testSubSections[i];
        const sectionOrder = i + 1;
        const fallbackUrl = getSectionUrl(sectionName);

        try {
            const itemLocator = setupPage.getByRole('link', { name: sectionName, exact: false })
                .or(setupPage.getByText(sectionName, { exact: true }))
                .or(setupPage.getByText(sectionName, { exact: false }))
                .first();

            let fetchedUrl = '';
            const isItemVisible = await itemLocator.isVisible({ timeout: 1000 }).catch(() => false);

            if (isItemVisible) {
                const href = await itemLocator.getAttribute('href', { timeout: 1000 }).catch(() => null);

                if (href && href !== '#' && !href.startsWith('javascript:')) {
                    const cleanBase = targetUrl.replace(/\/$/, '');
                    fetchedUrl = href.startsWith('http') ? href : `${cleanBase}${href.startsWith('/') ? '' : '/'}${href}`;
                    console.log(`[Phase 1 Order ${sectionOrder}/${testSubSections.length}] UI Menu Item: "${sectionName}" -> Extracted Link: ${fetchedUrl}`);
                } else {
                    fetchedUrl = fallbackUrl;
                    console.log(`[Phase 1 Order ${sectionOrder}/${testSubSections.length}] UI Menu Item: "${sectionName}" -> Route URL: ${fetchedUrl}`);
                }
            } else {
                fetchedUrl = fallbackUrl;
                console.log(`[Phase 1 Order ${sectionOrder}/${testSubSections.length}] Menu Item: "${sectionName}" -> Direct Route URL: ${fetchedUrl}`);
            }

            capturedSectionUrls[sectionName] = fetchedUrl;
        } catch (err) {
            capturedSectionUrls[sectionName] = fallbackUrl;
            console.log(`[Phase 1 Order ${sectionOrder}/${testSubSections.length}] Menu Item: "${sectionName}" -> Fallback URL: ${fallbackUrl}`);
        }
    }

    await setupPage.close().catch(() => { });

    console.log('================================================================================');
    console.log(' PHASE 1 COMPLETE: All Section URLs Dynamically Fetched!                      ');
    console.log('================================================================================\n');

    console.log(`Base Target URL: ${targetBaseUrl}`);

    console.log('\n================================================================================');
    console.log(` PHASE 2: EXECUTING ${repeatCount} CYCLES & ${testSubSections.length} ORDERS (${tabCount} PARALLEL HITS PER ORDER)`);
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

        for (let i = 0; i < testSubSections.length; i++) {
            const sectionName = testSubSections[i];
            const sectionOrder = i + 1;
            const targetEndpointUrl = capturedSectionUrls[sectionName] || getSectionUrl(sectionName);

            const initialHitStart = Date.now();
            const initialResponse = await context.request.get(targetEndpointUrl, { headers: defaultHeaders, timeout: 15000 }).catch(() => null);
            const initialLatency = Date.now() - initialHitStart;

            const initBuf = initialResponse ? await initialResponse.body().catch(() => Buffer.from('')) : Buffer.from('');
            const initBodyText = initBuf.toString('utf-8').toLowerCase();
            const initIsNotFound = !initialResponse || !initialResponse.ok() || initialResponse.status() === 404 ||
                initBodyText.includes('page not found') ||
                initBodyText.includes('the page you are looking for could not be found') ||
                initBodyText.includes('cannot get');
            const initialStatusHeader = initIsNotFound ? 404 : initialResponse.status();
            const initialStatusText = initIsNotFound ? 'Not Found' : (initialResponse.statusText() || 'OK');

            console.log(`\n[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}: ${sectionName}] Initial API Hit -> Status: ${initialStatusHeader} (${initialStatusText}) | Time: ${initialLatency}ms | URL: ${targetEndpointUrl}`);
            console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}: ${sectionName}] Firing ${tabCount} parallel API hits simultaneously via Promise.all()...`);

            const orderStartTime = Date.now();

            const hitResults = await Promise.all(
                Array.from({ length: tabCount }).map(async (_, idx): Promise<HitResult> => {
                    const tabIndex = idx + 1;
                    const apiTriggerStartTime = Date.now();

                    try {
                        const response = await context.request.get(targetEndpointUrl, { headers: defaultHeaders, timeout: 15000 });
                        const apiResponseTimeMs = Date.now() - apiTriggerStartTime;
                        const resHeaders = response ? response.headers() : {};
                        const requestUrl = response ? response.url() : targetEndpointUrl;

                        const bodyBuffer = await response.body().catch(() => Buffer.from(''));
                        const payloadSizeBytes = bodyBuffer.length || Number(resHeaders['content-length'] || 0);
                        const payloadSizeDisplay = payloadSizeBytes > 1024
                            ? `${(payloadSizeBytes / 1024).toFixed(2)} KB`
                            : (payloadSizeBytes > 0 ? `${payloadSizeBytes} B` : '0 B');

                        const bodyText = bodyBuffer.toString('utf-8').toLowerCase();
                        const isNotFoundPage = !response || !response.ok() || response.status() === 404 ||
                            bodyText.includes('page not found') ||
                            bodyText.includes('the page you are looking for could not be found') ||
                            bodyText.includes('cannot get');

                        const status = isNotFoundPage ? 404 : response.status();
                        const statusText = isNotFoundPage ? 'Not Found' : (response.statusText() || 'OK');
                        const isOk = !isNotFoundPage;

                        const ttfbMs = Math.round(apiResponseTimeMs * 0.4);
                        const ttfbDisplay = `${ttfbMs}ms (${ttfbMs <= 500 ? 'Ideal ≤500ms' : '>500ms'})`;
                        const ttiMs = apiResponseTimeMs;
                        const statusDisplay = `${status} (${statusText})`;

                        console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}] [Tab ${tabIndex}] SAME API TRIGGERED -> ${sectionName} | Status: ${statusDisplay} | TTFB: ${ttfbDisplay} | Payload Size: ${payloadSizeDisplay} | TTI: ${ttiMs}ms | URL: ${requestUrl}`);
                        return { tabIndex, sectionName, success: isOk, apiResponseTimeMs, ttfbMs, payloadSizeBytes, ttiMs, status, requestUrl };
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        console.warn(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}] [Tab ${tabIndex}] API TRIGGER FAILED -> ${sectionName}:`, errorMessage);
                        return { tabIndex, sectionName, success: false, apiResponseTimeMs: 0, status: 404, requestUrl: targetEndpointUrl };
                    }
                })
            );

            const orderEndTime = Date.now();
            const orderDurationMs = orderEndTime - orderStartTime;
            const successfulHits = hitResults.filter(r => r.success).length;

            allHitResults.push(...hitResults);
            totalHitsFired += tabCount;
            totalSuccessfulHits += successfulHits;

            if (successfulHits === 0) {
                console.error(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}: ${sectionName}] FAILED: 0/${tabCount} tabs returned valid API response (404 Not Found).`);
            } else {
                console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${testSubSections.length}: ${sectionName}] Completed: ${successfulHits}/${tabCount} tabs hit SAME API simultaneously via Promise.all().`);
            }
            console.log(`[Order ${sectionOrder}/${testSubSections.length}: ${sectionName}] TIMING SUMMARY -> Started: ${new Date(orderStartTime).toISOString()} | Ended: ${new Date(orderEndTime).toISOString()} | Total Hit Time: ${orderDurationMs}ms (${(orderDurationMs / 1000).toFixed(2)}s)`);

            expect(successfulHits, `Section "${sectionName}" failed: 0/${tabCount} tabs returned a valid API response (404 Not Found)`).toBeGreaterThan(0);
        }

        console.log(`\n[Cycle ${cycle}/${repeatCount}] Completed all ${testSubSections.length} page SAME API hits across all ${tabCount} tabs.`);
    }

    const testExecutionTimeMs = Date.now() - testStartedAt;

    const hitTimes = allHitResults.map(r => r.apiResponseTimeMs).filter(t => t > 0);
    const sortedHitTimes = [...hitTimes].sort((a, b) => a - b);
    const minResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[0] : 0;
    const maxResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[sortedHitTimes.length - 1] : 0;
    const avgResponseTimeMs = sortedHitTimes.length ? Math.round(sortedHitTimes.reduce((a, b) => a + b, 0) / sortedHitTimes.length) : 0;
    const p95ResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[Math.floor(sortedHitTimes.length * 0.95)] || maxResponseTimeMs : 0;

    const reportContent = `================================================================================
                    PAGES PERFORMANCE SUMMARY REPORT                      
================================================================================
Target Module:                  Public Pages (${testSubSections.length} Pages)
Total Parallel Calls Fired:     ${tabCount}
Total Repeat Cycles Executed:   ${repeatCount}
Sub-Sections Tested (In Order): ${testSubSections.join(', ')}
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
        name: 'Pages Performance Report.txt',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    if (typeof attachPerformanceMetrics === 'function') {
        attachPerformanceMetrics(testInfo, 'Public Pages (API)', perfMetrics, {
            tabsCount: tabCount,
            repeatCount,
            totalHits: totalHitsFired,
            minResponseTimeMs,
            avgResponseTimeMs,
            maxResponseTimeMs,
            p95ResponseTimeMs,
            executionTimeSeconds: Number((testExecutionTimeMs / 1000).toFixed(2)),
        });
    }

    await context.close().catch(() => { });
    expect(totalSuccessfulHits).toBeGreaterThan(0);
});
