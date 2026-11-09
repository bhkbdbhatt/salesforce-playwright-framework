import * as fs from 'fs';

interface StoredCookie {
    name: string;
    value: string;
}

interface StoredState {
    cookies?: StoredCookie[];
}

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
