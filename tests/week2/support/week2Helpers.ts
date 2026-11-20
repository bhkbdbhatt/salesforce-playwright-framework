import { expect, Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared helpers for the Week 2 scenarios.
 *
 * Keeping these checks in one place means every scenario validates generated
 * data, Salesforce IDs, collection contents, currency text and reports in the
 * same way. The PDF step mapping for each helper is documented in
 * tests/week2/README.md.
 */

export const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

/**
 * Accepts common Salesforce currency renderings, for example:
 * $1,234.00, 1 234,00, USD 1234, €950, ₹1,20,000.00.
 */
export const CURRENCY_TEXT_PATTERN =
    /^\s*(?:[A-Z]{3}\s*)?[$€£¥₹]?\s*-?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{1,2})?\s*$/;

export function createExecutionId(prefix: string): string {
    return `${prefix}_${Date.now()}_${randomCode(4)}`;
}

export function randomCode(length: number): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let value = '';

    for (let i = 0; i < length; i++) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    return value;
}

export function expectMatches(label: string, value: string, pattern: RegExp): void {
    expect(value, `${label} "${value}" should match ${pattern}`).toMatch(pattern);
}

export function expectSalesforceId(label: string, value: string): void {
    expect(value, `${label} "${value}" should be a Salesforce record ID`).toMatch(
        SALESFORCE_ID_PATTERN
    );
}

export function expectAllSalesforceIds(label: string, ids: string[]): void {
    for (const id of ids) {
        expectSalesforceId(label, id);
    }
}

export function futureDateIso(daysFromNow: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
}

export function escapeSoql(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function diffIds(
    expectedIds: string[],
    actualIds: string[]
): { missing: string[]; unexpected: string[]; duplicates: string[] } {
    const expected = new Set(expectedIds);
    const actual = new Set(actualIds);
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const id of actualIds) {
        if (seen.has(id)) {
            duplicates.add(id);
        } else {
            seen.add(id);
        }
    }

    return {
        missing: [...expected].filter(id => !actual.has(id)),
        unexpected: [...actual].filter(id => !expected.has(id)),
        duplicates: [...duplicates]
    };
}

export function assertCollection(label: string, expectedIds: string[], actualIds: string[]): void {
    const { missing, unexpected, duplicates } = diffIds(expectedIds, actualIds);

    expect(missing, `${label}: missing record IDs`).toEqual([]);
    expect(unexpected, `${label}: unexpected record IDs`).toEqual([]);
    expect(duplicates, `${label}: duplicate record IDs`).toEqual([]);
}

export function collectCollectionIssues(
    label: string,
    expectedIds: string[],
    actualIds: string[]
): string[] {
    const { missing, unexpected, duplicates } = diffIds(expectedIds, actualIds);
    const issues: string[] = [];

    for (const id of missing) {
        issues.push(`${label}: missing ${id}`);
    }
    for (const id of unexpected) {
        issues.push(`${label}: unexpected ${id}`);
    }
    for (const id of duplicates) {
        issues.push(`${label}: duplicate ${id}`);
    }

    return issues;
}

export function parseCurrency(text: string): number {
    const cleaned = text
        .replace(/[^\d.,-]/g, '')
        .replace(/,/g, '');

    const value = Number(cleaned);

    if (!Number.isFinite(value)) {
        throw new Error(`Unable to parse a currency value from "${text}".`);
    }

    return value;
}

export function expectCurrency(label: string, text: string, expected: number): void {
    expect(text, `${label} text "${text}" should use a currency format`).toMatch(
        CURRENCY_TEXT_PATTERN
    );
    expect(parseCurrency(text), `${label} numeric value`).toBeCloseTo(expected, 2);
}

export async function writeJsonReport(
    testInfo: TestInfo,
    fileName: string,
    data: unknown
): Promise<string> {
    const outputDir = path.join('test-results', 'week2');
    fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, fileName);
    const content = JSON.stringify(data, null, 2);

    fs.writeFileSync(outputPath, content);

    await testInfo
        .attach(fileName, {
            body: content,
            contentType: 'application/json'
        })
        .catch(() => undefined);

    return outputPath;
}

/**
 * Opens a Lightning record page and waits until the expected values appear.
 * Used by Scenario 1 step 9 (navigate the hierarchy through the UI),
 * Scenario 3 step 16 (compare UI with API/SOQL) and Scenario 4 step 13.
 */
export async function assertRecordPageShows(
    page: Page,
    objectApiName: string,
    recordId: string,
    expectedTexts: string[]
): Promise<void> {
    await page.goto(`/lightning/r/${objectApiName}/${recordId}/view`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(new RegExp(recordId));

    for (const text of expectedTexts) {
        await expect(page.locator('body')).toContainText(text, { timeout: 30000 });
    }
}

/**
 * Reads the Amount field from the Lightning Opportunity record page.
 * Returns the raw text so the caller can validate both the currency format and
 * the numeric value against the runtime collection.
 */
export async function readOpportunityAmountFromUi(
    page: Page,
    opportunityId: string
): Promise<string> {
    await page.goto(`/lightning/r/Opportunity/${opportunityId}/view`);
    await expect(page).toHaveURL(new RegExp(opportunityId));

    const amountValue = page
        .getByText('Amount', { exact: true })
        .first()
        .locator('xpath=following-sibling::p[1]');

    await expect(amountValue).toBeVisible({ timeout: 30_000 });
    const text = (await amountValue.innerText()).trim();
    const match = text.match(/^[$€£¥₹]?\s*-?\d[\d.,\s]*\d?$/);

    if (!match) {
        throw new Error(`Unexpected Opportunity Amount text "${text}" for ${opportunityId}.`);
    }

    return match[0].trim();
}

export async function assertOpportunityAmountInUi(
    page: Page,
    opportunityId: string,
    expectedAmount: number
): Promise<void> {
    const text = await readOpportunityAmountFromUi(page, opportunityId);
    expectCurrency(`Opportunity ${opportunityId} UI Amount`, text, expectedAmount);
}
