import { APIRequestContext } from '@playwright/test';
import * as path from 'path';
import { readSessionId } from './sessionState';

export interface LeadConvertOptions {
    convertedStatus?: string;
    opportunityName?: string;
    doNotCreateOpportunity?: boolean;
    overwriteLeadSource?: boolean;
}

export interface LeadConvertResult {
    leadId: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
    success: boolean;
}

interface SoapLeadConverterConfig {
    baseURL?: string;
    apiVersion?: string;
    authStatePath?: string;
    requestTimeoutMs?: number;
}

export class SoapLeadConverter {
    private readonly request: APIRequestContext;
    private readonly baseURL: string;
    private readonly apiVersion: string;
    private readonly authStatePath: string;
    private readonly requestTimeoutMs: number;

    constructor(request: APIRequestContext, config: SoapLeadConverterConfig = {}) {
        this.request = request;
        this.baseURL = (config.baseURL ?? process.env.SF_BASE_URL ?? '').replace(/\/$/, '');
        this.apiVersion = (config.apiVersion ?? process.env.SF_API_VERSION ?? 'v60.0').replace(/^v/, '');
        this.authStatePath =
            config.authStatePath ??
            process.env.SF_AUTH_STATE_FILE ??
            path.join(process.cwd(), '.auth', 'user.json');
        this.requestTimeoutMs =
            config.requestTimeoutMs ?? (Number(process.env.SF_API_TIMEOUT_MS) || 60000);

        if (!this.baseURL) {
            throw new Error('Missing SF_BASE_URL; the SOAP lead conversion endpoint needs it.');
        }

        if (!readSessionId(this.authStatePath)) {
            throw new Error(
                `No Salesforce session ID found at ${this.authStatePath}. Run the auth setup project first.`
            );
        }
    }

    async convertLead(leadId: string, options: LeadConvertOptions = {}): Promise<LeadConvertResult> {
        const sessionId = readSessionId(this.authStatePath);

        if (!sessionId) {
            throw new Error(`No Salesforce session ID found at ${this.authStatePath}.`);
        }

        const body = this.buildEnvelope(leadId, sessionId, options);
        const endpoint = `${this.baseURL}/services/Soap/u/${this.apiVersion}`;

        const response = await this.request.post(endpoint, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: '""'
            },
            data: body,
            timeout: this.requestTimeoutMs
        });

        const xml = await response.text();

        if (!response.ok()) {
            throw new Error(
                `SOAP convertLead failed with status ${response.status()} ${response.statusText()}: ${xml}`
            );
        }

        const success = this.extractTag(xml, 'success') === 'true';
        if (!success) {
            const messages = this.extractTagValues(xml, 'message');
            throw new Error(
                `SOAP convertLead did not succeed for Lead ${leadId}: ${
                    messages.length > 0 ? messages.join('; ') : xml
                }`
            );
        }

        return {
            leadId: this.extractTag(xml, 'leadId') ?? leadId,
            accountId: this.extractTag(xml, 'accountId'),
            contactId: this.extractTag(xml, 'contactId'),
            opportunityId: this.extractTag(xml, 'opportunityId'),
            success: true
        };
    }

    private buildEnvelope(leadId: string, sessionId: string, options: LeadConvertOptions): string {
        const convertedStatus = options.convertedStatus ?? 'Closed - Converted';
        const doNotCreateOpportunity = options.doNotCreateOpportunity ?? false;
        const overwriteLeadSource = options.overwriteLeadSource ?? false;

        const optionalOpportunityName = options.opportunityName
            ? `<tns:opportunityName>${this.escapeXml(options.opportunityName)}</tns:opportunityName>`
            : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:partner.soap.sforce.com">
  <soapenv:Header>
    <tns:SessionHeader>
      <tns:sessionId>${this.escapeXml(sessionId)}</tns:sessionId>
    </tns:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <tns:convertLead>
      <tns:leadConverts>
        <tns:leadId>${this.escapeXml(leadId)}</tns:leadId>
        <tns:convertedStatus>${this.escapeXml(convertedStatus)}</tns:convertedStatus>
        <tns:doNotCreateOpportunity>${doNotCreateOpportunity}</tns:doNotCreateOpportunity>
        <tns:overwriteLeadSource>${overwriteLeadSource}</tns:overwriteLeadSource>
        ${optionalOpportunityName}
      </tns:leadConverts>
    </tns:convertLead>
  </soapenv:Body>
</soapenv:Envelope>`;
    }

    private extractTag(xml: string, tag: string): string | undefined {
        const values = this.extractTagValues(xml, tag);
        return values[0];
    }

    private extractTagValues(xml: string, tag: string): string[] {
        const pattern = new RegExp(
            `<(?:(?:[A-Za-z0-9_.-]+):)?${tag}>([\\s\\S]*?)</(?:(?:[A-Za-z0-9_.-]+):)?${tag}>`,
            'g'
        );
        const values: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(xml)) !== null) {
            values.push(this.decodeXml(match[1].trim()));
        }

        return values;
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private decodeXml(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }
}
