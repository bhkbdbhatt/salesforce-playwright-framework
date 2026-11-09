import * as fs from 'fs';

interface StoredCookie {
    name: string;
    value: string;
}

interface StoredState {
    cookies?: StoredCookie[];
}

/**
 * Reads the Salesforce session ID (`sid` cookie) from the storageState file
 * written by tests/auth.setup.ts.
 *
 * Demo link to the PDF: this is how the "Login to Salesforce" step (step 1 of
 * every scenario) is reused by the API layer, so REST/SOQL calls made later
 * inherit the same authenticated session.
 */
export function readSessionId(storageStatePath: string): string | undefined {
    if (!fs.existsSync(storageStatePath)) {
        return undefined;
    }

    try {
        const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8')) as StoredState;
        return state.cookies?.find(cookie => cookie.name === 'sid')?.value;
    } catch {
        return undefined;
    }
}

export function authHeadersFromState(storageStatePath: string): Record<string, string> {
    const sid = readSessionId(storageStatePath);
    return sid ? { Authorization: `Bearer ${sid}` } : {};
}
