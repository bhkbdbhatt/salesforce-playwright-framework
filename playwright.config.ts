import { defineConfig, devices } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test/reporter';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const reporters: ReporterDescription[] = [['html', { open: 'never' }]];

if (process.env.TESTDINO_TOKEN) {
    reporters.push(['@testdino/playwright', { token: process.env.TESTDINO_TOKEN }]);
}

/**
 * Demo link to the PDF:
 * - The `setup` project runs tests/auth.setup.ts once (PDF step 1: Login).
 * - The `salesforce-e2e` project depends on `setup` and reuses .auth/user.json.
 * - `npm run test:repeat` passes --repeat-each=5, which satisfies the
 *   "5 consecutive executions" requirement in every scenario.
 * - `workers: 1` / `fullyParallel: false` avoid Salesforce API limits and
 *   record collisions across scenarios sharing one org.
 */
export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    retries: 0,
    workers: 1,
    timeout: 180000,
    expect: {
        timeout: 15000
    },

    use: {
        baseURL: process.env.SF_BASE_URL || 'https://login.salesforce.com',
        actionTimeout: 30000,
        navigationTimeout: 60000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },

    reporter: reporters,

    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                channel: 'chrome',
                headless: false,
                trace: 'off',
                video: 'off'
            }
        },
        {
            name: 'salesforce-e2e',
            testIgnore: /auth\.setup\.ts/,
            dependencies: ['setup'],
            use: {
                ...devices['Desktop Chrome'],
                channel: 'chrome',
                headless: false,
                storageState: path.join(__dirname, '.auth/user.json')
            }
        }
    ]
});
