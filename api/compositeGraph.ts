import { APIRequestContext } from '@playwright/test';
import * as path from 'path';
import { authHeadersFromState } from './sessionState';

/**
 * Salesforce Composite Graph API client used by Week 2 Scenario 4.
 *
 * Demo link to the PDF: Scenario 4 explicitly requires one Composite Graph per
 * customer and an atomic rollback when a single child request is invalid. The
 * graph endpoint is the only Salesforce API that provides that transactional
 * behaviour, so this client is used for the write step in both execution modes.
 * The UI mode still performs the PDF's UI validation and edit steps afterwards.
 */

export type CompositeHttpMethod = 'POST' | 'PATCH' | 'DELETE' | 'GET';

export interface CompositeRequestItem {
    method: CompositeHttpMethod;
    /** Relative resource path, for example /services/data/v60.0/sobjects/Account */
    url: string;
    referenceId: string;
    body?: Record<string, unknown>;
}

export interface CompositeGraphDefinition {
    graphId: string;
    compositeRequest: CompositeRequestItem[];
}

export interface CompositeSubResponse {
    referenceId: string;
    httpStatusCode: number;
    body: any;
}

export interface CompositeGraphResult {
    graphId: string;
    isSuccessful: boolean;
    responses: CompositeSubResponse[];
    raw: any;
}

export class CompositeGraphClient {
    private readonly apiVersion: string;
    private readonly authHeaders: Record<string, string>;
    private readonly requestTimeoutMs: number;

    constructor(
        private readonly request: APIRequestContext,
        apiVersion = process.env.SF_API_VERSION || 'v60.0',
        authStatePath = process.env.SF_AUTH_STATE_FILE ||
            path.join(process.cwd(), '.auth', 'user.json'),
        requestTimeoutMs = Number(process.env.SF_API_TIMEOUT_MS) || 60000
    ) {
        this.apiVersion = apiVersion;
        this.authHeaders = authHeadersFromState(authStatePath);
        this.requestTimeoutMs = requestTimeoutMs;

        if (!this.authHeaders.Authorization) {
            throw new Error(
                `No Salesforce session ID found at ${authStatePath}. Run the auth setup project first.`
            );
        }
    }

    recordUrl(objectApiName: string): string {
        return `/services/data/${this.apiVersion}/sobjects/${objectApiName}`;
    }

    async submit(graphs: CompositeGraphDefinition[]): Promise<CompositeGraphResult[]> {
        const response = await this.request.post(
            `/services/data/${this.apiVersion}/composite/graph`,
            {
                headers: {
                    ...this.authHeaders,
                    'Content-Type': 'application/json'
                },
                data: { graphs },
                timeout: this.requestTimeoutMs
            }
        );

        if (!response.ok()) {
            const body = await response.text();
            throw new Error(
                `Composite Graph request failed with status ${response.status()} ${response.statusText()}: ${body}`
            );
        }

        const payload = await response.json();
        const rawGraphs: any[] = payload.graphs ?? [];

        return rawGraphs.map(graph => ({
            graphId: graph.graphId,
            isSuccessful: Boolean(graph.isSuccessful),
            responses: (graph.graphResponse?.compositeResponse ?? []).map((item: any) => ({
                referenceId: item.referenceId,
                httpStatusCode: item.httpStatusCode,
                body: item.body
            })),
            raw: graph
        }));
    }
}

export function extractCreatedIds(result: CompositeGraphResult): Map<string, string> {
    const ids = new Map<string, string>();

    for (const response of result.responses) {
        const id = response.body?.id;

        if (response.httpStatusCode >= 200 && response.httpStatusCode < 300 && typeof id === 'string') {
            ids.set(response.referenceId, id);
        }
    }

    return ids;
}

export function summarizeGraphErrors(result: CompositeGraphResult): string[] {
    const errors: string[] = [];

    for (const response of result.responses) {
        if (response.httpStatusCode >= 400) {
            const messages = response.body?.message ? [String(response.body.message)] : [];
            if (response.body?.errors && Array.isArray(response.body.errors)) {
                for (const error of response.body.errors) {
                    if (error?.message) {
                        messages.push(String(error.message));
                    }
                }
            }
            errors.push(
                `${response.referenceId} (${response.httpStatusCode}): ${
                    messages.length > 0 ? messages.join('; ') : JSON.stringify(response.body)
                }`
            );
        }
    }

    return errors;
}
