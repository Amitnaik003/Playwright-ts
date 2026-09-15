import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 1. Locate Java JDK Installation
let javaHome = process.env.JAVA_HOME;

if (!javaHome || !fs.existsSync(javaHome)) {
  const searchPaths = [
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
    path.join(process.env.LOCALAPPDATA || '', 'Programs'),
    path.join(process.env.USERPROFILE || '', '.jdks')
  ];

  for (const basePath of searchPaths) {
    if (fs.existsSync(basePath)) {
      try {
        const dirs = fs.readdirSync(basePath);
        const jdkDir = dirs.find(d => 
          d.toLowerCase().includes('jdk') || 
          d.toLowerCase().includes('java') || 
          d.toLowerCase().includes('openjdk')
        );
        if (jdkDir) {
          javaHome = path.join(basePath, jdkDir);
          break;
        }
      } catch (e) {
        // Skip inaccessible directories
      }
    }
  }
}

// 2. Prepare Environment Variables
const env: NodeJS.ProcessEnv = { ...process.env };
const system32 = 'C:\\Windows\\System32';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0';

let pathParts = [system32, 'C:\\Windows', powershell];

if (javaHome) {
  env.JAVA_HOME = javaHome;
  pathParts.unshift(path.join(javaHome, 'bin'));
}

if (env.PATH) {
  pathParts.push(env.PATH);
}

env.PATH = pathParts.join(';');

const jmeterBat = 'C:\\apache-jmeter-5.6.3\\bin\\jmeter.bat';
const args = process.argv.slice(2);

// Extract JTL output path from args (-l <path>)
let jtlFile: string | null = null;
const lIndex = args.indexOf('-l');
if (lIndex !== -1 && args[lIndex + 1]) {
  jtlFile = path.resolve(process.cwd(), args[lIndex + 1]);
  // Clean up previous results file for fresh test metrics
  if (fs.existsSync(jtlFile)) {
    try {
      fs.unlinkSync(jtlFile);
    } catch (e) {
      // Ignore if file locked
    }
  }
}

console.log(`[JMeter Runner] Java Home: ${javaHome || 'Not set (using system PATH)'}`);
console.log(`[JMeter Runner] Executing: ${jmeterBat} ${args.join(' ')}`);

// 3. Spawn JMeter
const child = spawn(jmeterBat, args, {
  cwd: path.resolve(__dirname, '..'),
  env: env,
  stdio: 'inherit',
  shell: true
});

child.on('error', (err: Error) => {
  console.error('[JMeter Runner] Failed to start JMeter:', err.message);
  process.exit(1);
});

child.on('exit', (code: number | null) => {
  if (jtlFile && fs.existsSync(jtlFile)) {
    printConsoleLogs(jtlFile);
  }
  process.exit(code || 0);
});

// CSV parser helper
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

interface LabelStat {
  count: number;
  successCount: number;
  errorCount: number;
  latencies: number[];
  url: string;
  statusCodes: Set<string>;
}

// Helper: Parse JTL and print detailed console logs in exact execution order
function printConsoleLogs(filepath: string): void {
  try {
    const rawData = fs.readFileSync(filepath, 'utf-8');
    const lines = rawData.split('\n').filter(l => l.trim().length > 0);
    if (lines.length <= 1) return;

    const headers = parseCSVLine(lines[0]);
    const labelIdx = headers.indexOf('label');
    const elapsedIdx = headers.indexOf('elapsed');
    const successIdx = headers.indexOf('success');
    const responseCodeIdx = headers.indexOf('responseCode');
    const urlIdx = headers.indexOf('URL');

    const statsByLabel: Record<string, LabelStat> = {};
    const labelOrder: string[] = [];
    let totalHits = 0;
    let totalErrors = 0;
    const overallElapsed: number[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i]);
      if (parts.length < headers.length) continue;

      const label = parts[labelIdx] || 'Unknown';
      const elapsed = parseInt(parts[elapsedIdx], 10) || 0;
      const success = parts[successIdx] === 'true';
      const responseCode = parts[responseCodeIdx] || '';
      const url = parts[urlIdx] || '';

      totalHits++;
      if (!success) totalErrors++;
      overallElapsed.push(elapsed);

      if (!statsByLabel[label]) {
        labelOrder.push(label);
        statsByLabel[label] = {
          count: 0,
          successCount: 0,
          errorCount: 0,
          latencies: [],
          url: url,
          statusCodes: new Set<string>()
        };
      }

      statsByLabel[label].count++;
      if (success) statsByLabel[label].successCount++;
      else statsByLabel[label].errorCount++;
      statsByLabel[label].latencies.push(elapsed);
      if (responseCode) statsByLabel[label].statusCodes.add(responseCode);
    }

    // Preserve execution order, keeping Login at top
    labelOrder.sort((a, b) => {
      const isALogin = a.toLowerCase().includes('login');
      const isBLogin = b.toLowerCase().includes('login');
      if (isALogin && !isBLogin) return -1;
      if (!isALogin && isBLogin) return 1;
      return 0;
    });

    overallElapsed.sort((a, b) => a - b);
    const overallMin = overallElapsed[0] || 0;
    const overallMax = overallElapsed[overallElapsed.length - 1] || 0;
    const overallAvg = Math.round(overallElapsed.reduce((a, b) => a + b, 0) / (overallElapsed.length || 1));
    const p95Idx = Math.floor(overallElapsed.length * 0.95);
    const overallP95 = overallElapsed[p95Idx] || overallMax;

    console.log('\n====================================================================================================');
    console.log('                            JMETER CONSOLE LOG & PERFORMANCE METRICS SUMMARY                         ');
    console.log('====================================================================================================');

    labelOrder.forEach((label, idx) => {
      const stat = statsByLabel[label];
      stat.latencies.sort((a, b) => a - b);
      const min = stat.latencies[0] || 0;
      const max = stat.latencies[stat.latencies.length - 1] || 0;
      const avg = Math.round(stat.latencies.reduce((a, b) => a + b, 0) / (stat.latencies.length || 1));
      const p95 = stat.latencies[Math.floor(stat.latencies.length * 0.95)] || max;
      const successRate = ((stat.successCount / stat.count) * 100).toFixed(1);

      console.log(`\n[STEP ${idx + 1}] ${label}`);
      if (stat.url) console.log(`  - Target URL       : ${stat.url}`);
      console.log(`  - Total Hits       : ${stat.count} requests`);
      console.log(`  - Status Codes     : ${Array.from(stat.statusCodes).join(', ') || '200'}`);
      console.log(`  - Success / Errors : ${stat.successCount} Passed (${successRate}%) | ${stat.errorCount} Errors`);
      console.log(`  - Latency Metrics  : Min = ${min}ms | Avg = ${avg}ms | Max = ${max}ms | P95 = ${p95}ms`);
    });

    const overallSuccessRate = (((totalHits - totalErrors) / totalHits) * 100).toFixed(2);
    console.log('\n====================================================================================================');
    console.log(` OVERALL LOAD TEST RESULT: ${totalHits} TOTAL HITS | ${totalHits - totalErrors} PASSED (${overallSuccessRate}%) | ${totalErrors} ERRORS`);
    console.log(` OVERALL LATENCY STATS  : MIN = ${overallMin}ms | AVG = ${overallAvg}ms | MAX = ${overallMax}ms | P95 = ${overallP95}ms`);
    console.log('====================================================================================================\n');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[JMeter Runner] Error generating console log summary:', errorMessage);
  }
}
