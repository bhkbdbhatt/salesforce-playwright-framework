import { APIRequestContext, APIResponse } from '@playwright/test';
import * as path from 'path';
import { authHeadersFromState } from './sessionState';

export class SfApiClient {
    private readonly request: APIRequestContext;
    private readonly apiVersion: string;
    private readonly authHeaders: Record<string, string>;
    private readonly requestTimeoutMs: number;

    constructor(
        request: APIRequestContext,
        apiVersion = process.env.SF_API_VERSION || 'v60.0',
        authStatePath = process.env.SF_AUTH_STATE_FILE || path.join(process.cwd(), '.auth', 'user.json'),
        requestTimeoutMs = Number(process.env.SF_API_TIMEOUT_MS) || 60000
    ) {
        this.request = request;
        this.apiVersion = apiVersion;
        this.authHeaders = authHeadersFromState(authStatePath);
        this.requestTimeoutMs = requestTimeoutMs;

        if (!this.authHeaders.Authorization) {
            throw new Error(
                `No Salesforce session ID found at ${authStatePath}. Run the auth setup project first.`
            );
        }
    }

    private resourcePath(objectApiName: string, recordId?: string): string {
        const basePath = `/services/data/${this.apiVersion}/sobjects/${objectApiName}`;
        return recordId ? `${basePath}/${recordId}` : basePath;
    }

    private async ensureOk(response: APIResponse, action: string): Promise<void> {
        if (!response.ok()) {
            const body = await response.text();
            throw new Error(
                `${action} failed with status ${response.status()} ${response.statusText()}: ${body}`
            );
        }
    }

    async createRecord(objectApiName: string, payload: object): Promise<string> {
        const response = await this.request.post(this.resourcePath(objectApiName), {
            headers: this.authHeaders,
            data: payload,
            timeout: this.requestTimeoutMs
        });
        await this.ensureOk(response, `Create ${objectApiName}`);
        const body = await response.json();
        return body.id as string;
    }

    async updateRecord(objectApiName: string, recordId: string, payload: object): Promise<void> {
        const response = await this.request.patch(this.resourcePath(objectApiName, recordId), {
            headers: this.authHeaders,
            data: payload,
            timeout: this.requestTimeoutMs
        });
        await this.ensureOk(response, `Update ${objectApiName} ${recordId}`);
    }

    async deleteRecord(objectApiName: string, recordId: string): Promise<void> {
        const response = await this.request.delete(this.resourcePath(objectApiName, recordId), {
            headers: this.authHeaders,
            timeout: this.requestTimeoutMs
        });
        await this.ensureOk(response, `Delete ${objectApiName} ${recordId}`);
    }

    async getRecord<T = Record<string, unknown>>(
        objectApiName: string,
        recordId: string,
        fields?: string[]
    ): Promise<T> {
        const query = fields && fields.length > 0 ? `?fields=${fields.join(',')}` : '';
        const response = await this.request.get(
            `${this.resourcePath(objectApiName, recordId)}${query}`,
            {
                headers: this.authHeaders,
                timeout: this.requestTimeoutMs
            }
        );
        await this.ensureOk(response, `Get ${objectApiName} ${recordId}`);
        return response.json() as Promise<T>;
    }

    async query(soqlQuery: string): Promise<any> {
        const encodedQuery = encodeURIComponent(soqlQuery);
        const response = await this.request.get(
            `/services/data/${this.apiVersion}/query/?q=${encodedQuery}`,
            {
                headers: this.authHeaders,
                timeout: this.requestTimeoutMs
            }
        );
        await this.ensureOk(response, `SOQL query [${soqlQuery}]`);
        return response.json();
    }

    async queryRecords<T = any>(soqlQuery: string): Promise<T[]> {
        const result = await this.query(soqlQuery);
        return (result.records ?? []) as T[];
    }

    async queryOne<T = any>(soqlQuery: string): Promise<T> {
        const records = await this.queryRecords<T>(soqlQuery);
        if (records.length === 0) {
            throw new Error(`SOQL query returned no records: ${soqlQuery}`);
        }
        return records[0];
    }
}
