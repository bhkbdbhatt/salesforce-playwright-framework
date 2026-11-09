import type { LeadConvertOptions, LeadConvertResult } from '../api/soapLeadConverter';
import type { AccountData, ContactData, LeadData, OpportunityData } from '../utils/testDataGenerator';

/**
 * Contract shared by the API-backed and UI-backed Salesforce implementations.
 * Tests depend only on this interface, so they run unchanged in either mode.
 */
export interface SalesforceOperations {
    createAccount(data: AccountData | Record<string, unknown>): Promise<string>;
    createContact(data: ContactData | Record<string, unknown>): Promise<string>;
    createOpportunity(data: OpportunityData | Record<string, unknown>): Promise<string>;
    createLead(data: LeadData | Record<string, unknown>): Promise<string>;

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
