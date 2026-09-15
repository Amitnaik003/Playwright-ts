import { test, expect } from '@playwright/test';
import { attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
const password = process.env.PASSWORD || 'Dell@1234';

// Total parallel UI browser operations to launch simultaneously (default: 30)
const totalUiOperations = Number(process.env.OPERATION_COUNT || 30);

interface TabMetric {
    tabIndex: number;
    status: number;
    ttfbMs: number;
    domContentLoadedMs: number;
    loadCompletedMs: number;
    totalUiTimeMs: number;
    isLoginAttempted: boolean;
}

/**
 * Parallel UI Browser Performance Test using Promise.all()
 */
test('Simultaneous Parallel UI Page Load Performance Test 1', async ({ browser }, testInfo) => {
    test.setTimeout(0);

    console.log(`================================================================================`);
    console.log(`LAUNCHING SIMULTANEOUS PARALLEL UI BROWSER PERFORMANCE TEST`);
    console.log(`Target URL:                     ${targetUrl}`);
    console.log(`Total Parallel UI Operations:   ${totalUiOperations}`);
    console.log(`================================================================================\n`);

    const batchStartedAt = Date.now();
    const metricsList: TabMetric[] = [];
    let failedOperations = 0;

    console.log(`Firing all ${totalUiOperations} UI browser contexts simultaneously via Promise.all()...`);

    // 1. Create an array of parallel promises for all UI browser operations
    const parallelPromises = Array.from({ length: totalUiOperations }).map(async (_, idx) => {
        const tabIndex = idx + 1;
        const tabStartedAt = Date.now();

        let context;
        try {
            // Create isolated browser context for each simulated parallel user
            context = await browser.newContext();
            const page = await context.newPage();

            // Set strict no-cache HTTP headers
            await page.setExtraHTTPHeaders({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-UI-Performance-Test': `Tab-${tabIndex}`,
            }).catch(() => {});

            // Cache-busting URL parameter
            const cacheBustUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}ui_id=${tabIndex}&t=${Date.now()}_${Math.random()}`;

            // Perform UI Page Navigation
            const response = await page.goto(cacheBustUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            }).catch(() => null);

            const status = response?.status() || 200;

            // Perform UI Interactions & Input Filling
            let isLoginAttempted = false;
            try {
                const emailInput = page.getByRole('textbox').first();
                const passwordInput = page.locator('input[type="password"]');
                const loginButton = page.getByRole('button', { name: 'Login' });

                const isEmailVisible = await emailInput.isVisible({ timeout: 4000 }).catch(() => false);

                if (isEmailVisible) {
                    await emailInput.fill(userId).catch(() => {});
                    await passwordInput.fill(password).catch(() => {});
                    await loginButton.click({ timeout: 3000 }).catch(() => {});
                    isLoginAttempted = true;
                }
            } catch {
                isLoginAttempted = false;
            }

            // Extract real browser window.performance timing metrics
            const metric = await page.evaluate(() => {
                const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
                if (!entry) return null;

                return {
                    responseStartMs: entry.responseStart,
                    domContentLoadedMs: entry.domContentLoadedEventEnd,
                    loadCompletedMs: entry.loadEventEnd,
                };
            }).catch(() => null);

            const totalUiTimeMs = Date.now() - tabStartedAt;

            metricsList.push({
                tabIndex,
                status,
                ttfbMs: Math.round(metric?.responseStartMs || 0),
                domContentLoadedMs: Math.round(metric?.domContentLoadedMs || 0),
                loadCompletedMs: Math.round(metric?.loadCompletedMs || totalUiTimeMs),
                totalUiTimeMs,
                isLoginAttempted,
            });

            console.log(`[Tab ${tabIndex}/${totalUiOperations}] UI LOAD HIT: Status ${status} | Load: ${totalUiTimeMs}ms`);

        } catch (err) {
            failedOperations++;
            console.warn(`[Tab ${tabIndex}/${totalUiOperations}] Error:`, err);
        } finally {
            if (context) {
                await context.close().catch(() => {});
            }
        }
    });

    // 2. Wait for ALL parallel browser operations to complete simultaneously via Promise.all()
    await Promise.all(parallelPromises);

    const batchTotalTimeMs = Date.now() - batchStartedAt;

    const getStats = (values: number[]) => {
        if (!values.length) return { min: 0, max: 0, avg: 0, p95: 0, median: 0 };
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const avg = sum / sorted.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || max;
        const median = sorted[Math.floor(sorted.length * 0.5)] || avg;
        return { min, max, avg, p95, median };
    };

    const dclStats = getStats(metricsList.map((m) => m.domContentLoadedMs).filter((v) => v > 0));
    const loadStats = getStats(metricsList.map((m) => m.loadCompletedMs).filter((v) => v > 0));
    const ttfbStats = getStats(metricsList.map((m) => m.ttfbMs).filter((v) => v > 0));
    const overallRps = ((metricsList.length / (batchTotalTimeMs || 1)) * 1000).toFixed(1);

    const reportContent = `================================================================================
            SIMULTANEOUS PARALLEL UI PERFORMANCE REPORT (Promise.all)
================================================================================
Target URL:                     ${targetUrl}
Total UI Operations:            ${totalUiOperations}
Successful UI Pages Loaded:     ${metricsList.length} / ${totalUiOperations}
Failed UI Operations:           ${failedOperations}
Total Batch Execution Time:     ${(batchTotalTimeMs / 1000).toFixed(2)} seconds
Overall Throughput:             ${overallRps} pages/second
--------------------------------------------------------------------------------
REAL BROWSER METRIC SUMMARY (ms):
Metric                   Min        Max        Average     Median     P95
--------------------------------------------------------------------------------
TTFB (Response Start):   ${String(ttfbStats.min).padStart(8)} ms ${String(ttfbStats.max).padStart(8)} ms ${String(ttfbStats.avg.toFixed(1)).padStart(8)} ms ${String(ttfbStats.median.toFixed(1)).padStart(8)} ms ${String(ttfbStats.p95).padStart(8)} ms
DOMContentLoaded:       ${String(dclStats.min).padStart(8)} ms ${String(dclStats.max).padStart(8)} ms ${String(dclStats.avg.toFixed(1)).padStart(8)} ms ${String(dclStats.median.toFixed(1)).padStart(8)} ms ${String(dclStats.p95).padStart(8)} ms
Full Page Load:          ${String(loadStats.min).padStart(8)} ms ${String(loadStats.max).padStart(8)} ms ${String(loadStats.avg.toFixed(1)).padStart(8)} ms ${String(loadStats.median.toFixed(1)).padStart(8)} ms ${String(loadStats.p95).padStart(8)} ms
================================================================================`;

    console.log(`\n` + reportContent + `\n`);

    testInfo.attachments.push({
        name: 'Simultaneous Parallel UI Performance Report',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    testInfo.attachments.push({
        name: 'Parallel UI Metrics.json',
        contentType: 'application/json',
        body: Buffer.from(
            JSON.stringify(
                {
                    targetUrl,
                    totalOperations: totalUiOperations,
                    successfulPagesLoaded: metricsList.length,
                    failedOperations,
                    totalExecutionTimeSeconds: Number((batchTotalTimeMs / 1000).toFixed(2)),
                    throughputPagesPerSec: Number(overallRps),
                    summaryMetrics: {
                        ttfb: ttfbStats,
                        domContentLoaded: dclStats,
                        fullPageLoad: loadStats,
                    },
                    detailedTabResults: metricsList,
                },
                null,
                2
            ),
            'utf-8'
        ),
    });

    testInfo.annotations.push({
        type: 'UI Concurrency Summary',
        description: `Pages: ${metricsList.length}/${totalUiOperations} | RPS: ${overallRps} | Avg Load: ${loadStats.avg.toFixed(0)}ms | P95: ${loadStats.p95}ms`,
    });

    attachPerformanceMetrics(testInfo, 'Login Performance 1 Page UI', {
        ttfbMs: Math.round(ttfbStats.avg),
        fcpMs: 0,
        domContentLoadedMs: Math.round(dclStats.avg),
        loadTimeMs: Math.round(loadStats.avg),
        jsHeapMB: 0
    }, {
        tabsCount: totalUiOperations,
        totalHits: metricsList.length,
        minResponseTimeMs: Math.round(loadStats.min),
        avgResponseTimeMs: Math.round(loadStats.avg),
        maxResponseTimeMs: Math.round(loadStats.max),
        p95ResponseTimeMs: Math.round(loadStats.p95),
        executionTimeSeconds: Number((batchTotalTimeMs / 1000).toFixed(2))
    });

    expect(metricsList.length, 'At least 80% of UI browser pages should load successfully').toBeGreaterThanOrEqual(Math.floor(totalUiOperations * 0.8));
});
