import fs from 'fs';
import path from 'path';

export interface LoadTestMetricsDocument {
    processId: string;               // Unique Linked Processing ID / Run ID
    testModule: string;
    timestamp: string;
    startedDateTime: string;         // Started Date and Time
    endedDateTime: string;           // Ended Date and Time
    concurrencyLevel: number;        // Concurrency Level (Simultaneous Parallel Hits)
    totalHits: number;               // Total Hits
    passed200OK: number;             // Passed (200 OK)
    failedHitsCount: number;         // Failed Hits Number
    timedOutOver45s: number;         // Timed Out (>45s)
    successRate: string;             // Success Rate (e.g. "98.50%")
    avgLatencyMs: number;            // Avg Latency (in ms)
    avgLatencyFormatted: string;     // e.g. "450 ms"
    p95LatencyMs: number;            // P95 Latency (in ms)
    p95LatencyFormatted: string;     // e.g. "1200 ms"
    minLatencyMs: number;            // Min Latency (in ms)
    maxLatencyMs: number;            // Max Latency (in ms)
    executionTimeSeconds: number;    // Actual Execution Time in seconds
    maxExecutionTimeSeconds: number; // Target Max Execution Time limit in seconds
    maxExecutionTimeFormatted: string; // e.g. "120 sec" or "30 sec"
    singleHitTimeoutMs: number;      // Single Hit Request Timeout in ms (e.g. 10000)
    singleHitTimeoutSeconds: number; // Single Hit Request Timeout in seconds (e.g. 10)
    singleHitTimeoutFormatted: string; // e.g. "10 sec"
    mongoDbUriUsed?: string;         // Masked Connection String
    status: string;                  // Execution Status: SUCCESS | WARNING
}

export interface FailedHitDetail {
    id: number;
    apiUrl: string;
    status: number;
    responseTimeMs: number;
    success: boolean;
    payloadSizeBytes?: number;
    error: string | null;
}

export interface LoadTestErrorLogDocument {
    processId: string;               // Linked Processing ID matching master_load_metrics
    testModule: string;
    hitId: number;
    apiUrl: string;
    status: number;
    responseTimeMs: number;
    error: string;
    timestamp: string;
    mongoDbUriUsed?: string;
}

/**
 * Helper to dynamically load or auto-install the official "mongodb" driver package if missing
 */
function getMongoModule(): any {
    try {
        return require('mongodb');
    } catch {
        console.log(`\n [MongoDB Driver Auto-Installer] Package "mongodb" missing in node_modules.`);
        console.log(` Installing "mongodb" package bypassing corrupted lockfile...`);
        try {
            const { execSync } = require('child_process');
            execSync('npm config set registry https://registry.npmjs.org/', { cwd: process.cwd(), stdio: 'ignore', shell: true });
            execSync('npm install mongodb --no-package-lock --no-audit --no-fund', { cwd: process.cwd(), stdio: 'inherit', shell: true });
            console.log(` [MongoDB Driver Auto-Installer] Installation completed successfully!\n`);
            return require('mongodb');
        } catch (installErr: any) {
            console.error(` [MongoDB Auto-Install Notice] Could not auto-run npm install: ${installErr?.message || installErr}`);
            return null;
        }
    }
}

/**
 * Extracts a clean Database name from a MongoDB URI or defaults to 'warrantyDB'
 */
export function extractDatabaseName(mongoUri: string): string {
    try {
        const match = mongoUri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?/#]+)/);
        if (match && match[1] && !match[1].startsWith('?') && match[1].trim().length > 0) {
            return match[1].trim();
        }
    } catch { }
    return 'warrantyDB';
}

/**
 * Generates a unique, standardized Processing ID for linking metrics and error logs across MongoDB
 */
export function generateProcessId(prefix: string = 'PROC-LOAD'): string {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${timestamp}-${randomSuffix}`;
}

/**
 * Saves performance load test summary metrics ONLY to MongoDB database via Connection String,
 * stamped with a unique Processing ID and Started/Ended Date Times.
 */
export async function saveMetricsToMongoDB(
    connectionString: string | undefined,
    metrics: {
        processId?: string;
        testModule?: string;
        startedDateTime?: string;
        endedDateTime?: string;
        concurrencyLevel: number;
        totalHits: number;
        passed200OK: number;
        failedHitsCount?: number;
        timedOutOver45s: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
        minLatencyMs?: number;
        maxLatencyMs?: number;
        executionTimeSeconds?: number;
        maxExecutionTimeSeconds?: number;
        singleHitTimeoutMs?: number;
        singleHitTimeoutSeconds?: number;
    },
    collectionName: string = 'master_load_metrics'
): Promise<{ success: boolean; document: LoadTestMetricsDocument; message: string }> {
    const mongoUri = connectionString || process.env.MONGODB_URI || 'mongodb+srv://naikamit6773_db_user:QMPxukRH4dZ5HFjT@cluster0.cgajifz.mongodb.net/?appName=Cluster0';
    const maskedUri = mongoUri.replace(/:([^@]+)@/, ':****@');
    const targetDbName = extractDatabaseName(mongoUri);

    const activeProcessId = metrics.processId || generateProcessId('PROC-MASTER');

    const total = metrics.totalHits || 1;
    const rateNumber = ((metrics.passed200OK / total) * 100);
    const successRateStr = `${rateNumber.toFixed(2)}%`;

    const failedCount = metrics.failedHitsCount !== undefined
        ? metrics.failedHitsCount
        : Math.max(0, metrics.totalHits - metrics.passed200OK);

    const maxExecSec = metrics.maxExecutionTimeSeconds !== undefined
        ? metrics.maxExecutionTimeSeconds
        : Number((Number(process.env.MAX_EXECUTION_TIME_MS || process.env.TEST_TIMEOUT_MS || 120000) / 1000).toFixed(2));

    const singleHitMs = metrics.singleHitTimeoutMs !== undefined
        ? metrics.singleHitTimeoutMs
        : Number(process.env.SINGLE_HIT_TIMEOUT_MS || 10000);

    const singleHitSec = metrics.singleHitTimeoutSeconds !== undefined
        ? metrics.singleHitTimeoutSeconds
        : Number((singleHitMs / 1000).toFixed(2));

    const nowIso = new Date().toISOString();
    const document: LoadTestMetricsDocument = {
        processId: activeProcessId,
        testModule: metrics.testModule || 'Master Pages Backend REST API Load Test',
        timestamp: nowIso,
        startedDateTime: metrics.startedDateTime || nowIso,
        endedDateTime: metrics.endedDateTime || nowIso,
        concurrencyLevel: metrics.concurrencyLevel,
        totalHits: metrics.totalHits,
        passed200OK: metrics.passed200OK,
        failedHitsCount: failedCount,
        timedOutOver45s: metrics.timedOutOver45s,
        successRate: successRateStr,
        avgLatencyMs: metrics.avgLatencyMs,
        avgLatencyFormatted: `${metrics.avgLatencyMs} ms`,
        p95LatencyMs: metrics.p95LatencyMs,
        p95LatencyFormatted: `${metrics.p95LatencyMs} ms`,
        minLatencyMs: metrics.minLatencyMs || 0,
        maxLatencyMs: metrics.maxLatencyMs || 0,
        executionTimeSeconds: metrics.executionTimeSeconds || 0,
        maxExecutionTimeSeconds: maxExecSec,
        maxExecutionTimeFormatted: `${maxExecSec} sec`,
        singleHitTimeoutMs: singleHitMs,
        singleHitTimeoutSeconds: singleHitSec,
        singleHitTimeoutFormatted: `${singleHitSec} sec`,
        mongoDbUriUsed: maskedUri,
        status: rateNumber >= 90 ? 'SUCCESS' : 'WARNING'
    };

    console.log(`\n================================================================================`);
    console.log(` [MongoDB Direct Cloud Ingestion] Saving Summary Metrics to MongoDB`);
    console.log(`================================================================================`);
    console.log(` Connection String : ${maskedUri}`);
    console.log(` Target Database   : "${targetDbName}"`);
    console.log(` Target Collection : "${collectionName}"`);
    console.log(` Linked Processing ID : ${document.processId}`);
    console.log(` Summary Metrics Details :`);
    console.log(`   - Concurrency Level : ${document.concurrencyLevel}`);
    console.log(`   - Total Hits        : ${document.totalHits}`);
    console.log(`   - Passed (200 OK)   : ${document.passed200OK}`);
    console.log(`   - Failed Hits       : ${document.failedHitsCount}`);
    console.log(`   - Timed Out (>45s)  : ${document.timedOutOver45s}`);
    console.log(`   - Success Rate      : ${document.successRate}`);
    console.log(`   - Avg Latency       : ${document.avgLatencyFormatted}`);
    console.log(`   - P95 Latency       : ${document.p95LatencyFormatted}`);
    console.log(`   - Single Hit Timeout: ${document.singleHitTimeoutFormatted} (${document.singleHitTimeoutMs} ms)`);

    let connectedToLiveDb = false;
    try {
        const mongoModule = getMongoModule();
        if (mongoModule && mongoModule.MongoClient) {
            const client = new mongoModule.MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
            await client.connect();

            const db = client.db(targetDbName);
            const collection = db.collection(collectionName);

            const insertResult = await collection.insertOne(document);
            console.log(`\n [MongoDB LIVE INSERT SUCCESS] Summary Document inserted into ${targetDbName}.${collectionName} (_id: ${insertResult.insertedId})`);
            await client.close();
            connectedToLiveDb = true;
        } else {
            console.error(` [MongoDB Error] MongoClient driver unavailable. Please run "npm install mongodb".`);
        }
    } catch (err: any) {
        console.log(`\n================================================================================`);
        console.log(` [MongoDB Cloud Ingestion Warning] ${err?.message || 'Failed to connect to MongoDB Cloud'}`);
        console.log(` >>> Check MongoDB Atlas IP Whitelist (Network Access -> Allow 0.0.0.0/0).`);
        console.log(`================================================================================\n`);
    }

    console.log(`================================================================================\n`);

    return {
        success: connectedToLiveDb,
        document,
        message: connectedToLiveDb ? 'Metrics inserted into live MongoDB Cloud database!' : 'Failed to insert to MongoDB Cloud.'
    };
}

/**
 * Saves detailed error hit logs ONLY to the SAME MongoDB Cluster in collection "master_load_error_logs",
 * linked directly by the SAME Processing ID.
 */
export async function saveErrorLogsToMongoDB(
    connectionString: string | undefined,
    processId: string,
    failedHits: FailedHitDetail[],
    testModule: string = 'Master Pages Backend REST API Load Test',
    collectionName: string = 'master_load_error_logs'
): Promise<{ success: boolean; count: number; message: string }> {
    if (!failedHits || failedHits.length === 0) {
        console.log(`[MongoDB Error Log Notice] 0 Failed hits to save for Processing ID: ${processId}`);
        return { success: true, count: 0, message: 'No failed hits to log.' };
    }

    const mongoUri = connectionString || process.env.MONGODB_URI || 'mongodb+srv://naikamit6773_db_user:QMPxukRH4dZ5HFjT@cluster0.cgajifz.mongodb.net/?appName=Cluster0';
    const maskedUri = mongoUri.replace(/:([^@]+)@/, ':****@');
    const targetDbName = extractDatabaseName(mongoUri);

    const errorDocuments: LoadTestErrorLogDocument[] = failedHits.map(hit => ({
        processId,
        testModule,
        hitId: hit.id,
        apiUrl: hit.apiUrl,
        status: hit.status,
        responseTimeMs: hit.responseTimeMs,
        error: hit.error || 'Unknown Error',
        timestamp: new Date().toISOString(),
        mongoDbUriUsed: maskedUri
    }));

    console.log(`\n================================================================================`);
    console.log(` [MongoDB Direct Cloud Ingestion] Saving ${errorDocuments.length} Error Logs to MongoDB`);
    console.log(`================================================================================`);
    console.log(` Connection String : ${maskedUri}`);
    console.log(` Target Database   : "${targetDbName}"`);
    console.log(` Target Collection : "${collectionName}"`);
    console.log(` Linked Processing ID : ${processId}`);
    console.log(` Total Error Documents : ${errorDocuments.length}`);

    let connectedToLiveDb = false;
    try {
        const mongoModule = getMongoModule();
        if (mongoModule && mongoModule.MongoClient) {
            const client = new mongoModule.MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
            await client.connect();

            const db = client.db(targetDbName);
            const collection = db.collection(collectionName);

            const insertResult = await collection.insertMany(errorDocuments);
            console.log(`\n [MongoDB LIVE ERROR LOG SUCCESS] Inserted ${insertResult.insertedCount} error documents into ${targetDbName}.${collectionName}`);
            await client.close();
            connectedToLiveDb = true;
        }
    } catch (err: any) {
        console.log(`\n [MongoDB Error Logs Warning] ${err?.message || 'Failed to connect to MongoDB Cloud'}`);
    }

    console.log(`================================================================================\n`);

    return {
        success: connectedToLiveDb,
        count: errorDocuments.length,
        message: connectedToLiveDb ? 'Error logs inserted into live MongoDB Cloud database!' : 'Failed to insert error logs to MongoDB Cloud.'
    };
}
