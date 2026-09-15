import { test, expect } from '@playwright/test';
import { getPerformanceMetrics } from '../utils/perfMeter';

const targetUrl = process.env.BASE_URL || 'https://polite-pond-09fb16200.7.azurestaticapps.net/';
const operationCount = Number(process.env.OPERATION_COUNT || 100);

interface LoginResult {
    userIndex: number;
    durationMs: number;
    isSuccess: boolean;
    errorMessage: string;
}

test('performs logins and generates performance report', async ({ browser }, testInfo) => {
  // Disable test timeout completely to allow unrestricted execution time
  test.setTimeout(0);

  const userId = process.env.USER_ID || 'superadminmartinrea1@martinrea.com';
  const password = process.env.PASSWORD || 'Dell@1234';

  const batchStartedAt = Date.now();
  const results: LoginResult[] = [];

  try {
    for (let i = 0; i < operationCount; i++) {
      const userIndex = i + 1;
      console.log(`[${userIndex}/${operationCount}] Opening browser and starting login...`);

      const loginStartedAt = Date.now();
      let isSuccess = false;
      let errorMessage = '';

      const context = await browser.newContext();

      const page = await context.newPage();
      page.setDefaultTimeout(0);
      page.setDefaultNavigationTimeout(0);

      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const emailInput = page.getByRole('textbox').first();
        const passwordInput = page.locator('input[type="password"]');
        const loginButton = page.getByRole('button', { name: 'Login' });

        await emailInput.fill(userId);
        await passwordInput.fill(password);
        await loginButton.click();

        await expect(loginButton).toBeHidden({ timeout: 30000 });
        isSuccess = true;
        console.log(`[${userIndex}/${operationCount}] Login successful.`);

        // Extract real browser performance meters (TTFB, FCP, DCL, Load Time, Memory)
        const perfMetrics = await getPerformanceMetrics(page);
        console.log(`[Performance Meters] TTFB: ${perfMetrics.ttfbMs}ms | FCP: ${perfMetrics.fcpMs}ms | DCL: ${perfMetrics.domContentLoadedMs}ms | Load: ${perfMetrics.loadTimeMs}ms | Memory: ${perfMetrics.jsHeapMB}MB`);
      } catch (err) {
        isSuccess = false;
        errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[${userIndex}/${operationCount}] Login failed: ${errorMessage}`);
      } finally {
        await context.close().catch(() => {});
      }

      const durationMs = Date.now() - loginStartedAt;
      results.push({ userIndex, durationMs, isSuccess, errorMessage });
    }
  } finally {
    // End of batch
  }

  const batchTotalTimeMs = Date.now() - batchStartedAt;
  const successfulLogins = results.filter((r) => r.isSuccess);
  const failedLogins = results.filter((r) => !r.isSuccess);
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / (durations.length || 1);
  const minDuration = durations[0] || 0;
  const maxDuration = durations[durations.length - 1] || 0;
  const p95Index = Math.floor(durations.length * 0.95);
  const p95Duration = durations[p95Index] || maxDuration;

  const reportContent = `==================================================
      100 USERS LOGIN PERFORMANCE REPORT           
==================================================
Target URL:                     ${targetUrl}
Total Operations Attempted:     ${operationCount}
Successful Logins:              ${successfulLogins.length} / ${operationCount} (${((successfulLogins.length / operationCount) * 100).toFixed(1)}%)
Failed Logins:                  ${failedLogins.length}
Total Batch Execution Time:     ${(batchTotalTimeMs / 1000).toFixed(2)} seconds
--------------------------------------------------
Min Login Time:                 ${minDuration} ms (${(minDuration / 1000).toFixed(2)}s)
Max Login Time:                 ${maxDuration} ms (${(maxDuration / 1000).toFixed(2)}s)
Average Login Time:             ${avgDuration.toFixed(2)} ms (${(avgDuration / 1000).toFixed(2)}s)
95th Percentile (P95):          ${p95Duration} ms (${(p95Duration / 1000).toFixed(2)}s)
==================================================`;

  console.log(`\n` + reportContent + `\n`);

  // Attach formatted text report to Playwright HTML Report
  testInfo.attachments.push({
    name: 'Login Performance Report',
    contentType: 'text/plain',
    body: Buffer.from(reportContent, 'utf-8'),
  });

  // Attach structured JSON summary data to Playwright HTML Report
  testInfo.attachments.push({
    name: 'Login Performance Metrics.json',
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          targetUrl,
          totalOperations: operationCount,
          successfulLogins: successfulLogins.length,
          failedLogins: failedLogins.length,
          totalExecutionTimeSeconds: Number((batchTotalTimeMs / 1000).toFixed(2)),
          metrics: {
            minLoginTimeMs: minDuration,
            maxLoginTimeMs: maxDuration,
            avgLoginTimeMs: Number(avgDuration.toFixed(2)),
            p95LoginTimeMs: p95Duration,
          },
          detailedResults: results,
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
    description: `Success Rate: ${successfulLogins.length}/${operationCount} | Total Execution: ${(batchTotalTimeMs / 1000).toFixed(2)}s | Avg: ${(avgDuration / 1000).toFixed(2)}s | P95: ${(p95Duration / 1000).toFixed(2)}s`,
  });

  expect(successfulLogins.length, `All ${operationCount} logins should succeed`).toBe(operationCount);
});
