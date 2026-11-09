import { Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface FailureContext {
    executionId: string;
    testName: string;
    failedStep: string;
    recordId?: string;
    inputDataset?: unknown;
    expected?: unknown;
    actual?: unknown;
}

export async function captureFailure(
    page: Page,
    testInfo: TestInfo,
    context: FailureContext,
    error: unknown
): Promise<void> {
    const outputDir = path.join('test-results', 'diagnostics');
    fs.mkdirSync(outputDir, { recursive: true });

    const baseName = `${context.testName}-${context.executionId}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    const screenshotPath = path.join(outputDir, `${baseName}.png`);
    const diagnosticsPath = path.join(outputDir, `${baseName}.json`);

    try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (screenshotError) {
        console.warn(
            `Unable to capture failure screenshot: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`
        );
    }

    const diagnostics = {
        timestamp: new Date().toISOString(),
        testName: context.testName,
        executionId: context.executionId,
        failedStep: context.failedStep,
        recordId: context.recordId ?? 'N/A',
        inputDataset: context.inputDataset ?? 'N/A',
        expected: context.expected ?? 'N/A',
        actual: context.actual ?? 'N/A',
        pageUrl: page.url(),
        error:
            error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
        screenshot: fs.existsSync(screenshotPath) ? screenshotPath : 'N/A'
    };

    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));

    if (fs.existsSync(screenshotPath)) {
        await testInfo
            .attach('failure-screenshot', { path: screenshotPath, contentType: 'image/png' })
            .catch(() => undefined);
    }

    await testInfo
        .attach('failure-diagnostics', {
            body: JSON.stringify(diagnostics, null, 2),
            contentType: 'application/json'
        })
        .catch(() => undefined);

    console.error('=== TEST EXECUTION FAILURE DIAGNOSTICS ===');
    console.error(JSON.stringify(diagnostics, null, 2));
    console.error('==========================================');
}
