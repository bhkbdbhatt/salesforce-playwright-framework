import { Page } from '@playwright/test';
import { SalesforceService } from '../api/salesforceService';
import type { LeadConvertOptions, LeadConvertResult } from '../api/soapLeadConverter';
import { BasePage } from '../page-objects/BasePage';
import { LeadPage } from '../page-objects/LeadPage';
import type { SalesforceOperations } from '../services/salesforceOperations';
import type { AccountData, ContactData, LeadData, OpportunityData } from '../utils/testDataGenerator';

/**
 * UI-backed implementation of SalesforceOperations.
 *
 * Writes (create/update/delete/convert) run through the Lightning UI with
 * Playwright. Reads (SOQL/REST GET) delegate to the API because they are the
 * backend verification layer and have no UI equivalent.
 */
export class UiSalesforceService extends BasePage implements SalesforceOperations {
    private readonly api: SalesforceService;
    private readonly leadPage: LeadPage;

    constructor(page: Page) {
        super(page);
        this.api = new SalesforceService(page.request);
        this.leadPage = new LeadPage(page);
    }

    createAccount(data: AccountData | Record<string, unknown>): Promise<string> {
        return this.createRecord('Account', data);
    }

    createContact(data: ContactData | Record<string, unknown>): Promise<string> {
        return this.createRecord('Contact', data);
    }

    createOpportunity(data: OpportunityData | Record<string, unknown>): Promise<string> {
        return this.createRecord('Opportunity', data);
    }

    createLead(data: LeadData | Record<string, unknown>): Promise<string> {
        return this.createRecord('Lead', data);
    }

    updateAccount(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.editRecord('Account', recordId, data);
    }

    updateContact(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.editRecord('Contact', recordId, data);
    }

    updateOpportunity(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.editRecord('Opportunity', recordId, data);
    }

    updateLead(recordId: string, data: Record<string, unknown>): Promise<void> {
        return this.editRecord('Lead', recordId, data);
    }

    async convertLead(leadId: string, _options: LeadConvertOptions = {}): Promise<LeadConvertResult> {
        await this.leadPage.navigateToLead(leadId);
        await this.leadPage.convertLeadThroughUI();

        const lead = await this.api.getLeadStatus(leadId);
        const success = Boolean(lead.IsConverted);

        if (!success) {
            throw new Error(`Lead ${leadId} was not converted through the Lightning UI.`);
        }

        return {
            leadId,
            accountId: lead.ConvertedAccountId,
            contactId: lead.ConvertedContactId,
            opportunityId: lead.ConvertedOpportunityId,
            success
        };
    }

    // Read-only verification always uses SOQL/REST through the API.
    getRecord<T = Record<string, unknown>>(
        objectApiName: string,
        recordId: string,
        fields?: string[]
    ): Promise<T> {
        return this.api.getRecord<T>(objectApiName, recordId, fields);
    }

    query(soqlQuery: string): Promise<any> {
        return this.api.query(soqlQuery);
    }

    queryRecords<T = any>(soqlQuery: string): Promise<T[]> {
        return this.api.queryRecords<T>(soqlQuery);
    }

    queryOne<T = any>(soqlQuery: string): Promise<T> {
        return this.api.queryOne<T>(soqlQuery);
    }

    getFullSalesLifecycle(accountId: string): Promise<any> {
        return this.api.getFullSalesLifecycle(accountId);
    }

    getAccountHierarchy(parentAccountId: string): Promise<any> {
        return this.api.getAccountHierarchy(parentAccountId);
    }

    getLeadStatus(leadId: string): Promise<any> {
        return this.api.getLeadStatus(leadId);
    }

    getOpportunityByName(accountId: string, name: string): Promise<any> {
        return this.api.getOpportunityByName(accountId, name);
    }

    getConvertedLeadStatus(): Promise<string> {
        return this.api.getConvertedLeadStatus();
    }
}
