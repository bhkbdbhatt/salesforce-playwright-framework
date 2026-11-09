/**
 * PDF step 1 of ALL FIVE scenarios — "Login to Salesforce".
 *
 * This setup project runs once before the e2e suite. It logs in through the
 * Playwright browser, completes the two-step username/password flow, waits for
 * MFA if required, and saves the authenticated session to .auth/user.json.
 * The e2e project then reuses that storageState, so every scenario starts
 * already logged in. A stored session is validated against /services/data/
 * (not the Lightning home page) so an expired session triggers a fresh login.
 */
import { test as setup, request, APIRequestContext } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { authHeadersFromState } from '../api/sessionState';

dotenv.config();

const authFile = path.join(__dirname, '../.auth/user.json');

function envNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const loginTimeoutMs = envNumber('SF_LOGIN_TIMEOUT_MS', 30000);
const mfaTimeoutMs = envNumber('SF_MFA_TIMEOUT_MS', 300000);

async function isStoredSessionValid(baseURL: string, storageStatePath: string): Promise<boolean> {
    if (!fs.existsSync(storageStatePath)) {
        return false;
    }

    const authHeaders = authHeadersFromState(storageStatePath);
    if (!authHeaders.Authorization) {
        return false;
    }

    let apiContext: APIRequestContext | undefined;
    try {
        apiContext = await request.newContext({
            baseURL,
            storageState: storageStatePath,
            extraHTTPHeaders: authHeaders
        });

        // The Lightning home page returns HTTP 200 even without a session, so validate
        // against the REST API, which returns 401 for an unauthenticated/expired session.
        // This org also requires the session ID as a Bearer token; cookies alone are rejected.
        const response = await apiContext.get('/services/data/', { maxRedirects: 0 });
        return response.status() === 200;
    } catch {
        return false;
    } finally {
        await apiContext?.dispose().catch(() => undefined);
    }
}

setup('authenticate salesforce session', async ({ page }) => {
    setup.setTimeout(loginTimeoutMs + mfaTimeoutMs + 120000);

    const baseURL = process.env.SF_BASE_URL || 'https://login.salesforce.com';
    const username = process.env.SF_USERNAME;
    const password = process.env.SF_PASSWORD;

    if (!username || !password) {
        throw new Error('Missing Salesforce username or password in your .env file!');
    }

    const authDir = path.dirname(authFile);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    if (process.env.SF_FORCE_LOGIN !== 'true' && await isStoredSessionValid(baseURL, authFile)) {
        console.log(`Valid Salesforce session found at ${authFile}; skipping login.`);
        return;
    }

    const loginUrl = `${baseURL.replace(/\/$/, '')}/`;
    console.log(`Navigating to Salesforce login URL: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Some orgs expose a "Login with Email" entry point before the username field.
    const loginWithEmailBtn = page.locator(
        'button:has-text("Login with Email"), a:has-text("Login with Email")'
    );
    if (await loginWithEmailBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await loginWithEmailBtn.click();
        console.log('Clicked "Login with Email"');
    }

    await page.locator('#username').waitFor({ state: 'visible', timeout: 15000 });
    await page.fill('#username', username);

    // This org uses a two-step login: submit the username, then the password field appears.
    const passwordField = page.locator('#password');
    if (!(await passwordField.isVisible({ timeout: 3000 }).catch(() => false))) {
        await page.click('#Login, button[type="submit"]');
    }
    await passwordField.waitFor({ state: 'visible', timeout: 15000 });
    await page.fill('#password', password);
    await page.click('#Login, button[type="submit"]');
    console.log('Credentials submitted. Waiting for the Lightning dashboard...');

    const loginError = page.locator('#error:visible, .loginError:visible').first();
    const outcome = await Promise.race([
        page
            .waitForURL('**/lightning/**', { timeout: loginTimeoutMs })
            .then(() => 'success' as const)
            .catch(() => 'timeout' as const),
        loginError
            .waitFor({ state: 'visible', timeout: loginTimeoutMs })
            .then(() => 'error' as const)
            .catch(() => 'timeout' as const)
    ]);

    if (outcome === 'error') {
        const message = (await loginError.textContent().catch(() => null))?.trim();
        throw new Error(`Salesforce login failed: ${message || 'unknown login error'}`);
    }

    if (outcome === 'timeout') {
        console.log(
            `No automatic redirect after ${loginTimeoutMs}ms. MFA/verification is likely required.`
        );

        if (process.env.SF_MFA_PAUSE === 'true') {
            console.log('>>> PAUSED: Complete MFA in the browser, then click "Resume" in Playwright Inspector. <<<');
            await page.pause();
        } else {
            console.log(
                `Complete the verification step in the browser window. Waiting up to ${mfaTimeoutMs}ms...`
            );
        }

        await page.waitForURL('**/lightning/**', { timeout: mfaTimeoutMs });
    }

    console.log('Successfully logged into Salesforce Lightning.');

    await page.context().storageState({ path: authFile });
    console.log(`Authentication state saved to: ${authFile}`);
});
