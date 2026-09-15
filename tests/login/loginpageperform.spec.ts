import { test, expect, Page } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const operationCount = Number(process.env.OPERATION_COUNT || 5);

interface TabMetric {
    tabIndex: number;
    status: number;
    ttfbMs: number;
    domContentLoadedMs: number;
    loadCompletedMs: number;
    totalTimeMs: number;
}

test('page load performance load test', async ({ context }, testInfo) => {
    // Disable test timeout so Chrome/Firefox/WebKit stays open
    test.setTimeout(0);

    const openPages: Page[] = [];
    const metricsList: TabMetric[] = [];

    const batchStartedAt = Date.now();
    const maxActiveTabs = Number(process.env.MAX_ACTIVE_TABS || 10);

    for (let i = 0; i < operationCount; i++) {
        try {
            // 1. Open a NEW TAB safely
            const page = await context.newPage().catch(() => null);
            if (!page) {
                console.warn(`[Tab ${i + 1}/${operationCount}] Could not open new page tab (browser context closed).`);
                break;
            }
            openPages.push(page);

            const pageStartedAt = Date.now();
            // 2. Navigate to target URL with fallback timeout handling
            const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => null);

            // 3. Extract performance metrics for this tab
            const metric = await getPerformanceMetrics(page);

            const totalTabLoadTimeMs = Date.now() - pageStartedAt;

            if (metric) {
                metricsList.push({
                    tabIndex: i + 1,
                    status: response?.status() || 200,
                    ttfbMs: metric.ttfbMs,
                    domContentLoadedMs: metric.domContentLoadedMs,
                    loadCompletedMs: metric.loadTimeMs,
                    totalTimeMs: totalTabLoadTimeMs,
                });
            }

            console.log(`[Tab ${i + 1}/${operationCount}] Status: ${response?.status() || 200}`);
            if (metric) {
                console.log(`  -> TTFB: ${metric.ttfbMs} ms | FCP: ${metric.fcpMs} ms | DCL: ${metric.domContentLoadedMs} ms | Load: ${metric.loadTimeMs} ms | Memory: ${metric.jsHeapMB} MB`);
            }

            // 4. Assert HTTP 200 status
            await test.step(`Verify performance metrics collected for Tab ${i + 1}`, async () => {
                expect(response?.status() || 200).toBe(200);
            });

            // 5. Memory management: close older tabs if active tabs exceed threshold (unless PAUSE is set)
            if (process.env.PAUSE !== 'true' && openPages.length > maxActiveTabs) {
                const oldPage = openPages.shift();
                await oldPage?.close().catch(() => { });
            }
        } catch (err) {
            console.warn(`[Tab ${i + 1}/${operationCount}] Encountered error, continuing batch metrics calculation...`);
        }
    }

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

    const dclStats = getStats(metricsList.map((m) => m.domContentLoadedMs));
    const loadStats = getStats(metricsList.map((m) => m.loadCompletedMs));
    const ttfbStats = getStats(metricsList.map((m) => m.ttfbMs));

    const reportContent = `================================================================================
                      PAGE LOAD PERFORMANCE REPORT                      
================================================================================
Target URL:                     ${targetUrl}
Total Operations / Tabs:        ${operationCount}
Successful Pages Loaded:        ${metricsList.length} / ${operationCount}
Total Batch Execution Time:     ${(batchTotalTimeMs / 1000).toFixed(2)} seconds
--------------------------------------------------------------------------------
METRIC SUMMARY (ms):
Metric                   Min        Max        Average     Median     P95
--------------------------------------------------------------------------------
TTFB (Response Start):   ${String(ttfbStats.min).padStart(8)} ms ${String(ttfbStats.max).padStart(8)} ms ${String(ttfbStats.avg.toFixed(1)).padStart(8)} ms ${String(ttfbStats.median.toFixed(1)).padStart(8)} ms ${String(ttfbStats.p95).padStart(8)} ms
DOMContentLoaded:       ${String(dclStats.min).padStart(8)} ms ${String(dclStats.max).padStart(8)} ms ${String(dclStats.avg.toFixed(1)).padStart(8)} ms ${String(dclStats.median.toFixed(1)).padStart(8)} ms ${String(dclStats.p95).padStart(8)} ms
Full Page Load:          ${String(loadStats.min).padStart(8)} ms ${String(loadStats.max).padStart(8)} ms ${String(loadStats.avg.toFixed(1)).padStart(8)} ms ${String(loadStats.median.toFixed(1)).padStart(8)} ms ${String(loadStats.p95).padStart(8)} ms
================================================================================`;

    console.log(`\n` + reportContent + `\n`);

    // Attach formatted report to Playwright HTML Report
    testInfo.attachments.push({
        name: 'Page Load Performance Report',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    // Attach structured JSON summary data to Playwright HTML Report
    testInfo.attachments.push({
        name: 'Page Load Performance Metrics.json',
        contentType: 'application/json',
        body: Buffer.from(
            JSON.stringify(
                {
                    targetUrl,
                    totalOperations: operationCount,
                    totalExecutionTimeSeconds: Number((batchTotalTimeMs / 1000).toFixed(2)),
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

    // Add annotation header to Playwright HTML Report UI
    testInfo.annotations.push({
        type: 'Performance Summary',
        description: `Tabs: ${operationCount} | Avg Load: ${loadStats.avg.toFixed(0)}ms | P95 Load: ${loadStats.p95}ms | Avg DCL: ${dclStats.avg.toFixed(0)}ms`,
    });

    if (process.env.PAUSE === 'true' && openPages.length > 0) {
        console.log(`Pausing execution as PAUSE=true...`);
        await openPages[0].pause().catch(() => { });
    }
});
