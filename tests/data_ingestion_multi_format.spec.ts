import { test, expect } from '@playwright/test';
import { loadDataFromSource } from './utils/dataIngestion';

test.describe('Dynamic Multi-Format Data Ingestion System', () => {

  test('Should automatically ingest 3,000 records from CSV data source', async () => {
    const result = await loadDataFromSource('data/warranty_analytics_3000.csv');
    console.log(`[CSV Test] ${result.datasetSummary}`);
    console.log(` -> Total Claims: ${result.metrics.totalClaimCount.toLocaleString()}`);
    console.log(` -> Total Repair Cost: $${result.metrics.totalRepairCost.toLocaleString()}`);

    expect(result.sourceType).toBe('CSV');
    expect(result.totalRecords).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
  });

  test('Should automatically ingest records when CSV file is swapped with Excel (.xlsx)', async () => {
    const result = await loadDataFromSource('data/warranty_analytics_3000.xlsx');
    console.log(`[Excel Test] ${result.datasetSummary}`);
    console.log(` -> Total Claims: ${result.metrics.totalClaimCount.toLocaleString()}`);
    console.log(` -> Total Repair Cost: $${result.metrics.totalRepairCost.toLocaleString()}`);

    expect(result.sourceType).toBe('EXCEL');
    expect(result.totalRecords).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
  });

  test('Should automatically ingest records from JSON file source', async () => {
    const result = await loadDataFromSource('data/warranty_analytics_3000.json');
    console.log(`[JSON Test] ${result.datasetSummary}`);

    expect(result.sourceType).toBe('JSON');
    expect(result.totalRecords).toBeGreaterThan(0);
  });

  test('Should automatically connect & fetch live 3,000 records from MongoDB Connection String', async () => {
    const mongoUri = 'mongodb://superadmin:Dell1234@localhost:27017/warrantyDB?authSource=admin';
    const result = await loadDataFromSource(mongoUri);

    console.log(`[MongoDB Test] ${result.datasetSummary}`);
    console.log(` -> Total Claims: ${result.metrics.totalClaimCount.toLocaleString()}`);
    console.log(` -> Avg Failure PPM: ${result.metrics.avgFailurePPM} PPM`);

    expect(result.sourceType).toBe('MONGODB');
    expect(result.totalRecords).toBe(3000);
    expect(result.records[0].mongoDb).toBe('warrantyDB');
  });

});
