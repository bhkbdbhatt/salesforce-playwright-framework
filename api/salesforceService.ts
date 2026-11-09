import { APIRequestContext } from '@playwright/test';
import * as path from 'path';
import { SfApiClient } from './sfApiClient';
import {
    LeadConvertOptions,
    LeadConvertResult,
    SoapLeadConverter
} from './soapLeadConverter';
import { SoqlQueries } from './soqlQueries';
import type { SalesforceOperations } from '../services/salesforceOperations';
import type { AccountData, ContactData, LeadData, OpportunityData } from '../utils/testDataGenerator';

export interface SalesforceServiceConfig {
    apiVersion?: string;
    authStatePath?: string;
    requestTimeoutMs?: number;
}

/**
 * API-backed implementation of SalesforceOperations (default mode).
 *
 * Demo link to the PDF: this class covers the "using Playwright API" steps —
 * create Account/Contact/Opportunity/Lead, update records, delete records,
 * SOQL queries and the relationship queries used for validation. Lead
 * conversion is delegated to SoapLeadConverter because REST has no equivalent.
 */
export class SalesforceService implements SalesforceOperations {
    private readonly rest: SfApiClient;
    private readonly leadConverter: SoapLeadConverter;

    constructor(request: APIRequestContext, config: SalesforceServiceConfig = {}) {
        const apiVersion = config.apiVersion ?? process.env.SF_API_VERSION ?? 'v60.0';
        const authStatePath =
            config.authStatePath ??
            process.env.SF_AUTH_STATE_FILE ??
            path.join(process.cwd(), '.auth', 'user.json');
        const requestTimeoutMs =
            config.requestTimeoutMs ?? (Number(process.env.SF_API_TIMEOUT_MS) || 60000);

        this.rest = new SfApiClient(request, apiVersion, authStatePath, requestTimeoutMs);
        this.leadConverter = new SoapLeadConverter(request, {
            baseURL: process.env.SF_BASE_URL,
            apiVersion,
            authStatePath,
            requestTimeoutMs
        });
    }

    createAccount(data: AccountData | Record<string, unknown>): Promise<string> {
        return this.rest.createRecord('Account', data);
    }

    createContact(data: ContactData | Record<string, unknown>): Promise<string> {
        return this.rest.createRecord('Contact', data);
    }

    createOpportunity(data: OpportunityData | Record<string, unknown>): Promise<string> {
        return this.rest.createRecord('Opportunity', data);
    }

    createLead(data: LeadData | Record<string, unknown>): Promise<string> {
        return this.rest.createRecord('Lead', data);
    }

    updateAccount(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.rest.updateRecord('Account', recordId, data);
    }

    updateContact(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.rest.updateRecord('Contact', recordId, data);
    }

    updateOpportunity(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.rest.updateRecord('Opportunity', recordId, data);
    }

    updateLead(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.rest.updateRecord('Lead', recordId, data);
    }

    deleteRecord(objectApiName: string, recordId: string): Promise<void> {
        return this.rest.deleteRecord(objectApiName, recordId);
    }

    getRecord<T = Record<string, unknown>>(
        objectApiName: string,
        recordId: string,
        fields?: string[]
    ): Promise<T> {
        return this.rest.getRecord<T>(objectApiName, recordId, fields);
    }

    query(soqlQuery: string): Promise<any> {
        return this.rest.query(soqlQuery);
    }

    queryRecords<T = any>(soqlQuery: string): Promise<T[]> {
        return this.rest.queryRecords<T>(soqlQuery);
    }

    queryOne<T = any>(soqlQuery: string): Promise<T> {
        return this.rest.queryOne<T>(soqlQuery);
    }

    getFullSalesLifecycle(accountId: string): Promise<any> {
        return this.queryOne(SoqlQueries.getFullSalesLifecycle(accountId));
    }

    getAccountHierarchy(parentAccountId: string): Promise<any> {
        return this.queryOne(SoqlQueries.getAccountHierarchy(parentAccountId));
    }

    getLeadStatus(leadId: string): Promise<any> {
        return this.queryOne(SoqlQueries.getLeadStatus(leadId));
    }

    getOpportunityByName(accountId: string, name: string): Promise<any> {
        return this.queryOne(SoqlQueries.getOpportunityByName(accountId, name));
    }

    async getConvertedLeadStatus(): Promise<string> {
        const records = await this.queryRecords<{ MasterLabel: string }>(
            'SELECT MasterLabel FROM LeadStatus WHERE IsConverted = true ORDER BY SortOrder LIMIT 1'
        );

        if (records.length === 0) {
            throw new Error('No converted Lead status is configured in this Salesforce org.');
        }

        return records[0].MasterLabel;
    }

    convertLead(leadId: string, options: LeadConvertOptions = {}): Promise<LeadConvertResult> {
        return this.leadConverter.convertLead(leadId, options);
    }
}
