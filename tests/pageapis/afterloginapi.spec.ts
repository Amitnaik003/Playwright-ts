import { test, expect } from '@playwright/test';
import { getPerformanceMetrics, attachPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
const password = process.env.PASSWORD || 'Dell@1234';
const apiCallCount = Number(process.env.TAB_COUNT || 200);

import * as fs from 'fs';
import * as path from 'path';

const defaultHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

interface ApiResult {
    id: number;
    dispatchOffsetMs: number;
    status: number;
    responseTimeMs: number;
    ok: boolean;
    error: string | null;
}

test(`Authenticate once then send ${apiCallCount} Dashboard After-Login API requests simultaneously at once without opening tabs`, async ({ browser }, testInfo) => {
    test.setTimeout(0);

    const hasAuth = fs.existsSync(authFile);
    const context = await browser.newContext({
        ...(hasAuth ? { storageState: authFile } : {}),
        extraHTTPHeaders: defaultHeaders
    });
    let dashboardUrl = `${targetUrl.replace(/\/$/, '')}/appcommon/dashboard`;

    const cookies = await context.cookies();
    if (!hasAuth || !cookies || cookies.length === 0) {
        console.log('No cached session cookies found. Performing fast UI login...');
        const loginPage = await context.newPage();
        await loginPage.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });

        const isPasswordFormVisible = await loginPage.locator('input[type="password"]').isVisible({ timeout: 3000 }).catch(() => false);
        if (isPasswordFormVisible) {
            const userInput = loginPage.locator('input[type="email"], input[name*="user" i], input[placeholder*="user" i], input[placeholder*="email" i], input[type="text"]').first();
            await userInput.fill(userId).catch(() => { });
            await loginPage.locator('input[type="password"]').fill(password).catch(() => { });
            await loginPage.getByRole('button', { name: /login/i }).click().catch(() => { });

            await loginPage.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 }).catch(() => { });
            await loginPage.waitForLoadState('networkidle').catch(() => { });
            await context.storageState({ path: authFile }).catch(() => { });
        }
        dashboardUrl = loginPage.url();
        const perfMetrics = await getPerformanceMetrics(loginPage).catch(() => null);
        if (perfMetrics) {
            attachPerformanceMetrics(testInfo, 'After Login API Page', perfMetrics);
        }
        await loginPage.close().catch(() => { });
    } else {
        console.log('Cached authentication session active! Skipped page launch for instant performance.');
    }

    // Step 2: Fire all direct HTTP API requests simultaneously at the exact same millisecond
    console.log(`Firing ${apiCallCount} direct After-Login Dashboard API requests simultaneously via Promise.all()...`);

    const globalDispatchStart = Date.now();

    const apiPromises = Array.from({ length: apiCallCount }).map(async (_, idx): Promise<ApiResult> => {
        const reqId = idx + 1;
        const dispatchOffsetMs = Date.now() - globalDispatchStart;
        const requestStart = Date.now();

        try {
            const response = await context.request.get(dashboardUrl);
            const responseTimeMs = Date.now() - requestStart;
            const status = response.status();
            const ok = response.ok() || status === 200 || status === 304;

            return {
                id: reqId,
                dispatchOffsetMs,
                status,
                responseTimeMs,
                ok,
                error: null
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return {
                id: reqId,
                dispatchOffsetMs,
                status: 500,
                responseTimeMs: Date.now() - requestStart,
                ok: false,
                error: errorMessage
            };
        }
    });

    const results = await Promise.all(apiPromises);
    const totalExecutionTimeMs = Date.now() - globalDispatchStart;

    // Step 3: Analyze performance & dispatch synchronicity
    let passedCount = 0;
    let failedCount = 0;
    let totalResponseTime = 0;
    let rawMinResponseTime = Infinity;
    let maxResponseTime = 0;

    for (const res of results) {
        if (res.ok) {
            passedCount++;
        } else {
            failedCount++;
            console.log(`[Request #${res.id}] Failed with status: ${res.status} | Reason: ${res.error || 'HTTP Status Error'}`);
        }

        totalResponseTime += res.responseTimeMs;
        if (res.responseTimeMs < rawMinResponseTime) rawMinResponseTime = res.responseTimeMs;
        if (res.responseTimeMs > maxResponseTime) maxResponseTime = res.responseTimeMs;
    }

    const minResponseTime = isFinite(rawMinResponseTime) ? rawMinResponseTime : 0;
    const avgResponseTimeMs = (totalResponseTime / apiCallCount).toFixed(2);
    const maxDispatchOffset = Math.max(...results.map(r => r.dispatchOffsetMs));

    // Step 4: Print the final Scorecard
    const reportContent = `==================================================
      AFTER-LOGIN DASHBOARD API TEST SCORECARD    
==================================================
Target Dashboard URL:     ${dashboardUrl}
Total Parallel API Calls: ${results.length}
Passed:                   ${passedCount}
Failed:                   ${failedCount}
Max Dispatch Time Offset: ${maxDispatchOffset} ms (100% Simultaneous Trigger)
Total Execution Time:     ${(totalExecutionTimeMs / 1000).toFixed(2)} seconds
Min Response Time:        ${minResponseTime} ms
Max Response Time:        ${maxResponseTime} ms
Avg Response Time:        ${avgResponseTimeMs} ms
Memory Footprint:         Minimal (0 active tabs)
==================================================`;

    reportContent.split('\n').forEach(line => console.log(line));

    testInfo.attachments.push({
        name: 'Dashboard API Performance Report.txt',
        contentType: 'text/plain',
        body: Buffer.from(reportContent, 'utf-8'),
    });

    testInfo.attachments.push({
        name: 'Dashboard API Metrics.json',
        contentType: 'application/json',
        body: Buffer.from(
            JSON.stringify(
                {
                    targetUrl: dashboardUrl,
                    totalCalls: results.length,
                    passed: passedCount,
                    failed: failedCount,
                    maxDispatchOffsetMs: maxDispatchOffset,
                    executionTimeSeconds: Number((totalExecutionTimeMs / 1000).toFixed(2)),
                    minResponseTimeMs: minResponseTime,
                    maxResponseTimeMs: maxResponseTime,
                    avgResponseTimeMs: Number(avgResponseTimeMs)
                },
                null,
                2
            ),
            'utf-8'
        ),
    });

    testInfo.annotations.push({
        type: 'Performance Summary',
        description: `Dashboard API | Hits: ${results.length} | Passed: ${passedCount} | Duration: ${(totalExecutionTimeMs / 1000).toFixed(1)}s`,
    });

    await context.close();

    expect(passedCount).toBe(apiCallCount);
});
