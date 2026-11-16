import type { LeadConvertOptions, LeadConvertResult } from '../api/soapLeadConverter';
import type { AccountData, ContactData, LeadData, OpportunityData } from '../utils/testDataGenerator';

/**
 * Contract shared by the API-backed and UI-backed Salesforce implementations.
 * Tests depend only on this interface, so they run unchanged in either mode.
 *
 * Demo link to the PDF: the scenarios say steps like "create using Playwright
 * API" and "convert through Salesforce UI". Both are the same interface call
 * here; the active implementation decides whether that call uses REST/SOAP or
 * the Lightning UI. Read operations (query/get*) are the SOQL/REST validation
 * layer used by the "Execute SOQL" and "validate through backend" steps.
 */
export interface SalesforceOperations {
    createAccount(data: AccountData | Record<string, unknown>): Promise<string>;
    createContact(data: ContactData | Record<string, unknown>): Promise<string>;
    createOpportunity(data: OpportunityData | Record<string, unknown>): Promise<string>;
    createLead(data: LeadData | Record<string, unknown>): Promise<string>;

    /**
     * Week 2 scenarios also create records that do not have a dedicated helper:
     * Product2, Pricebook2, PricebookEntry, OpportunityLineItem,
     * OpportunityContactRole and the Composite Graph payloads. These generic
     * methods keep the create/update strategy consistent with the active mode.
     */
    createRecord(objectApiName: string, data: Record<string, unknown>): Promise<string>;
    updateRecord(objectApiName: string, recordId: string, data: Record<string, unknown>): Promise<void>;

    updateAccount(recordId: string, data: Record<string, unknown>): Promise<void>;
    updateContact(recordId: string, data: Record<string, unknown>): Promise<void>;
    updateOpportunity(recordId: string, data: Record<string, unknown>): Promise<void>;
    updateLead(recordId: string, data: Record<string, unknown>): Promise<void>;

    deleteRecord(objectApiName: string, recordId: string): Promise<void>;

    getRecord<T = Record<string, unknown>>(
        objectApiName: string,
        recordId: string,
        fields?: string[]
    ): Promise<T>;

    query(soqlQuery: string): Promise<any>;
    queryRecords<T = any>(soqlQuery: string): Promise<T[]>;
    queryOne<T = any>(soqlQuery: string): Promise<T>;

    getFullSalesLifecycle(accountId: string): Promise<any>;
    getAccountHierarchy(parentAccountId: string): Promise<any>;
    getLeadStatus(leadId: string): Promise<any>;
    getOpportunityByName(accountId: string, name: string): Promise<any>;
    getConvertedLeadStatus(): Promise<string>;

    convertLead(leadId: string, options?: LeadConvertOptions): Promise<LeadConvertResult>;
}
