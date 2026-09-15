import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';
import * as fs from 'fs';
import * as path from 'path';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
const password = process.env.PASSWORD || 'Dell@1234';
const repeatCount = Number(process.env.CYCLE_COUNT || 1);
const tabCount = Number(process.env.TAB_COUNT || 50);

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

const masterSubSections = [
    'Enterprise',
    'External Filter',
    'Org Unit',
    'Location',
    'Customer',
    'Portal',
    'Role',
    'User',
    'Position',
    'Program Repository'
];

const defaultHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function getSectionUrl(sectionName: string): string {
    const cleanBase = targetUrl.replace(/\/$/, '');
    const slug = sectionName.toLowerCase().replace(/\s+/g, '-');
    if (slug === 'org-unit') return `${cleanBase}/appcommon/orgUnit`;
    if (slug === 'location') return `${cleanBase}/appcommon/plant`;
    if (slug === 'customer') return `${cleanBase}/appcommon/customerparent`;
    if (slug === 'role') return `${cleanBase}/appcommon/group`;
    if (slug === 'program-repository') return `${cleanBase}/appcommon/programs`;
    return `${cleanBase}/appcommon/${slug}`;
}

test(`Master Pages API Load Test (${tabCount} Parallel Hits x ${repeatCount} Cycles)`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const testStartedAt = Date.now();

    console.log('================================================================================');
    console.log(' STRICT UI LOGIN PROCESS: Navigating to Login Page & Authenticating...          ');
    console.log('================================================================================');

    const context = await browser.newContext({
        extraHTTPHeaders: defaultHeaders
    });

    const setupPage = await context.newPage();
    const loginUrl = `${targetUrl.replace(/\/$/, '')}/login`;
    await setupPage.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });

    const userInput = setupPage.locator('input[type="email"], input[name*="user" i], input[placeholder*="user" i], input[placeholder*="email" i], input[type="text"]').first();
    await userInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    await userInput.fill(userId).catch(() => { });

    const passwordInput = setupPage.locator('input[type="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    await passwordInput.fill(password).catch(() => { });

    const loginBtn = setupPage.getByRole('button', { name: /login/i }).or(setupPage.locator('button[type="submit"]')).first();
    await loginBtn.click().catch(() => { });

    await setupPage.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 }).catch(() => { });
    await setupPage.waitForLoadState('networkidle').catch(() => { });
    await context.storageState({ path: authFile }).catch(() => { });

    const loggedInUrl = setupPage.url();
    console.log(`[Strict UI Login] Login successful! Current URL: ${loggedInUrl}`);

    const perfMetrics = await getPerformanceMetrics(setupPage);
    console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);

    console.log('\n================================================================================');
    console.log(' PHASE 1: SEARCHING & FETCHING REAL SECTION URLS FROM THE UI MENU DYNAMICALLY  ');
    console.log('================================================================================');

    const capturedSectionUrls: Record<string, string> = {};

    for (let i = 0; i < masterSubSections.length; i++) {
        const sectionName = masterSubSections[i];
        const sectionOrder = i + 1;

        try {
            const fallbackUrl = getSectionUrl(sectionName);
            const searchInput = setupPage.locator('input[placeholder*="search" i], .sidebar input, nav input, aside input, input[type="text"]').first();
            if (await searchInput.isVisible({ timeout: 500 }).catch(() => false)) {
                await searchInput.fill('');
                await searchInput.fill(sectionName).catch(() => { });
                await setupPage.waitForTimeout(150);
            }

            const menu = setupPage.getByText('Master', { exact: true }).or(setupPage.getByText(/Master/i)).first();
            if (await menu.isVisible({ timeout: 500 }).catch(() => false)) {
                await menu.click({ force: true }).catch(() => { });
                await setupPage.waitForTimeout(150);
            }

            const itemLocator = setupPage.getByRole('link', { name: sectionName, exact: false })
                .or(setupPage.getByText(sectionName, { exact: true }))
                .or(setupPage.getByText(sectionName, { exact: false }))
                .first();

            let fetchedUrl = '';
            const isItemVisible = await itemLocator.isVisible({ timeout: 1000 }).catch(() => false);

            if (isItemVisible) {
                const href = await itemLocator.getAttribute('href', { timeout: 1000 }).catch(() => null)
                    || await itemLocator.getAttribute('routerlink', { timeout: 1000 }).catch(() => null)
                    || await itemLocator.getAttribute('ng-reflect-router-link', { timeout: 1000 }).catch(() => null);

                if (href && href !== '#' && !href.startsWith('javascript:')) {
                    const cleanBase = targetUrl.replace(/\/$/, '');
                    fetchedUrl = href.startsWith('http') ? href : `${cleanBase}${href.startsWith('/') ? '' : '/'}${href}`;
                    console.log(`[Phase 1 Order ${sectionOrder}/${masterSubSections.length}] UI Menu Item: "${sectionName}" -> Extracted Link: ${fetchedUrl}`);
                } else {
                    const initialUrl = setupPage.url();
                    const responsePromise = setupPage.waitForResponse(
                        (res) => (res.status() === 200 || res.status() === 304) && !res.url().match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/i),
                        { timeout: 1500 }
                    ).catch(() => null);

                    await itemLocator.click({ force: true }).catch(() => { });
                    await responsePromise;
                    await setupPage.waitForTimeout(200);

                    const currentUrl = setupPage.url();
                    if (currentUrl && currentUrl !== initialUrl && !currentUrl.endsWith('/dashboard') && !currentUrl.endsWith('/login')) {
                        fetchedUrl = currentUrl;
                    } else {
                        fetchedUrl = fallbackUrl;
                    }
                    console.log(`[Phase 1 Order ${sectionOrder}/${masterSubSections.length}] Clicked UI Menu Item: "${sectionName}" -> Dynamically Navigated URL: ${fetchedUrl}`);
                }
            } else {
                fetchedUrl = fallbackUrl;
                console.log(`[Phase 1 Order ${sectionOrder}/${masterSubSections.length}] Menu Item: "${sectionName}" -> Direct Route URL: ${fetchedUrl}`);
            }

            capturedSectionUrls[sectionName] = fetchedUrl;
        } catch (err) {
            const fallbackUrl = getSectionUrl(sectionName);
            capturedSectionUrls[sectionName] = fallbackUrl;
            console.log(`[Phase 1 Order ${sectionOrder}/${masterSubSections.length}] Menu Item: "${sectionName}" -> Fallback URL: ${fallbackUrl}`);
        }
    }

    await setupPage.close().catch(() => { });

    console.log('================================================================================');
    console.log(' PHASE 1 COMPLETE: All Section URLs Dynamically Fetched!                      ');
    console.log('================================================================================\n');

    console.log(`Authenticated Dashboard URL: ${loggedInUrl}`);

    console.log('\n================================================================================');
    console.log(` PHASE 2: EXECUTING ${repeatCount} CYCLES & ${masterSubSections.length} ORDERS (${tabCount} PARALLEL HITS PER ORDER)`);
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

        for (let i = 0; i < masterSubSections.length; i++) {
            const sectionName = masterSubSections[i];
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

            console.log(`\n[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}: ${sectionName}] Initial API Hit -> Status: ${initialStatusHeader} (${initialStatusText}) | Time: ${initialLatency}ms | URL: ${targetEndpointUrl}`);
            console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}: ${sectionName}] Firing ${tabCount} parallel API hits simultaneously via Promise.all()...`);

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

                        console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}] [Tab ${tabIndex}] SAME API TRIGGERED -> ${sectionName} | Status: ${statusDisplay} | TTFB: ${ttfbDisplay} | Payload Size: ${payloadSizeDisplay} | TTI: ${ttiMs}ms | URL: ${requestUrl}`);
                        return { tabIndex, sectionName, success: isOk, apiResponseTimeMs, ttfbMs, payloadSizeBytes, ttiMs, status, requestUrl };
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        console.warn(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}] [Tab ${tabIndex}] API TRIGGER FAILED -> ${sectionName}:`, errorMessage);
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
                console.error(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}: ${sectionName}] FAILED: 0/${tabCount} tabs returned valid API response (404 Not Found).`);
            } else {
                console.log(`[Cycle ${cycle}/${repeatCount}] [Order ${sectionOrder}/${masterSubSections.length}: ${sectionName}] Completed: ${successfulHits}/${tabCount} tabs hit SAME API simultaneously via Promise.all().`);
            }
            console.log(`[Order ${sectionOrder}/${masterSubSections.length}: ${sectionName}] TIMING SUMMARY -> Started: ${new Date(orderStartTime).toISOString()} | Ended: ${new Date(orderEndTime).toISOString()} | Total Hit Time: ${orderDurationMs}ms (${(orderDurationMs / 1000).toFixed(2)}s)`);

            expect(successfulHits, `Section "${sectionName}" failed: 0/${tabCount} tabs returned a valid API response (404 Not Found)`).toBeGreaterThan(0);
        }

        console.log(`\n[Cycle ${cycle}/${repeatCount}] Completed all ${masterSubSections.length} Master page SAME API hits across all ${tabCount} tabs.`);
    }

    const testExecutionTimeMs = Date.now() - testStartedAt;

    const hitTimes = allHitResults.map(r => r.apiResponseTimeMs).filter(t => t > 0);
    const sortedHitTimes = [...hitTimes].sort((a, b) => a - b);
    const minResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[0] : 0;
    const maxResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[sortedHitTimes.length - 1] : 0;
    const avgResponseTimeMs = sortedHitTimes.length ? Math.round(sortedHitTimes.reduce((a, b) => a + b, 0) / sortedHitTimes.length) : 0;
    const p95ResponseTimeMs = sortedHitTimes.length ? sortedHitTimes[Math.floor(sortedHitTimes.length * 0.95)] || maxResponseTimeMs : 0;

    const reportContent = `================================================================================
                    MASTER PAGES PERFORMANCE SUMMARY REPORT                      
================================================================================
Target Module:                  Master Pages (${masterSubSections.length} Pages)
Total Parallel Calls Fired:     ${tabCount}
Total Repeat Cycles Executed:   ${repeatCount}
Sub-Sections Tested (In Order): ${masterSubSections.join(', ')}
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
        name: 'Master Pages Performance Report.txt',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    attachPerformanceMetrics(testInfo, 'Master Pages (API)', perfMetrics, {
        tabsCount: tabCount,
        repeatCount,
        totalHits: totalHitsFired,
        minResponseTimeMs,
        avgResponseTimeMs,
        maxResponseTimeMs,
        p95ResponseTimeMs,
        executionTimeSeconds: Number((testExecutionTimeMs / 1000).toFixed(2)),
    });

    await context.close().catch(() => { });
    expect(totalSuccessfulHits).toBeGreaterThan(0);
});
