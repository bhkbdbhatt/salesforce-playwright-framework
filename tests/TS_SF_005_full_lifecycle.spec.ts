import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../services/salesforceServiceFactory';
import { TestDataGenerator, LeadData } from '../utils/testDataGenerator';
import { CleanupManager, reconcileTrackedLeads } from '../utils/cleanupManager';
import { captureFailure } from '../utils/diagnostics';

interface LeadJourney {
    dataset: LeadData & { shouldConvert: boolean };
    leadId?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
}

test('TS_SF_005: Complete Lead-to-Sales Lifecycle with Dynamic Validation and Recovery', async ({ page }, testInfo) => {
    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);

    // 2. Generate a unique test-execution ID.
    const executionId = `LIFECYCLE_${Date.now()}`;
    const nestedCollection = new Map<string, LeadJourney>();
    const extraContacts: { id: string; payload: Record<string, any> }[] = [];
    const extraOpportunities: { id: string; payload: Record<string, any> }[] = [];

    const updatedOppStage = 'Negotiation/Review';
    const updatedOppAmount = 123456;
    const extraStages = ['Value Proposition', 'Id. Decision Makers'];

    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let lastRecordId: string | undefined;

    try {
        // Salesforce requires an org-configured converted Lead status.
        const convertedStatus = await sfApi.getConvertedLeadStatus();

        // 3 & 4. Dynamically generate and create multiple Lead datasets.
        const datasets = [0, 1, 2].map(index => {
            const data = TestDataGenerator.generateLeadData(index);
            return {
                ...data,
                LastName: `Lifecycle_${executionId}_${index + 1}`,
                Company: `LifecycleCo_${executionId}_${index + 1}`,
                shouldConvert: data.Rating === 'Hot' || data.Rating === 'Warm'
            };
        });

        for (const [index, dataset] of datasets.entries()) {
            // 4 & 5. Create the Lead and store the ID in the nested collection.
            failedStep = `Create Lead ${index + 1}`;
            const leadId = await sfApi.createLead({
                FirstName: dataset.FirstName,
                LastName: dataset.LastName,
                Company: dataset.Company,
                LeadSource: dataset.LeadSource,
                Industry: dataset.Industry,
                Rating: dataset.Rating,
                Country: dataset.Country,
                Status: dataset.Status
            });
            lastRecordId = leadId;

            const journey: LeadJourney = { dataset, leadId };
            nestedCollection.set(leadId, journey);
            cleanup.track('Lead', leadId);

            // 6 & 7. Convert eligible Leads through the Salesforce SOAP API.
            if (dataset.shouldConvert) {
                failedStep = `Convert Lead ${index + 1} via API`;
                const result = await sfApi.convertLead(leadId, {
                    convertedStatus,
                    opportunityName: `${dataset.Company} Opportunity`
                });
                expect(result.success).toBeTruthy();

                // 8. Capture the generated Account, Contact and Opportunity records.
                failedStep = `Capture converted records for Lead ${index + 1}`;
                const convertedLead = await sfApi.getLeadStatus(leadId);
                expect(convertedLead.IsConverted).toBeTruthy();

                journey.accountId = result.accountId ?? convertedLead.ConvertedAccountId;
                journey.contactId = result.contactId ?? convertedLead.ConvertedContactId;
                journey.opportunityId = result.opportunityId ?? convertedLead.ConvertedOpportunityId;

                // A converted Lead cannot be deleted, so clean up its generated records instead.
                cleanup.untrack('Lead', leadId);
                cleanup.track('Account', journey.accountId);
                cleanup.track('Contact', journey.contactId);
                cleanup.track('Opportunity', journey.opportunityId);
            }
        }

        const primaryJourney = Array.from(nestedCollection.values()).find(
            journey => journey.dataset.shouldConvert && journey.accountId
        );
        if (!primaryJourney?.accountId) {
            throw new Error('No Lead was converted, so the sales lifecycle cannot continue.');
        }
        const primaryAccountId = primaryJourney.accountId;

        // 9. Add additional Contacts to the converted Account through the API.
        for (let i = 0; i < 2; i++) {
            failedStep = `Add additional Contact ${i + 1} through API`;
            const contactPayload = TestDataGenerator.generateContactData(primaryAccountId);
            contactPayload.LastName = `Secondary_${executionId}_${i + 1}`;
            const contactId = await sfApi.createContact(contactPayload);
            extraContacts.push({ id: contactId, payload: contactPayload });
            cleanup.track('Contact', contactId);
        }

        // 10. Create additional Opportunities with varying Stage, Amount and Close Date.
        for (let i = 0; i < 2; i++) {
            failedStep = `Add additional Opportunity ${i + 1} through API`;
            const oppPayload = TestDataGenerator.generateOpportunityData(primaryAccountId, 45 + i * 15);
            oppPayload.Name = `Expansion_${executionId}_${i + 1}`;
            oppPayload.StageName = extraStages[i];
            oppPayload.Amount = 50000 * (i + 1);
            const oppId = await sfApi.createOpportunity(oppPayload);
            extraOpportunities.push({ id: oppId, payload: oppPayload });
            cleanup.track('Opportunity', oppId);
        }

        // 11. Update a selected Opportunity through the Salesforce API.
        failedStep = 'Update selected Opportunity through API';
        await sfApi.updateOpportunity(extraOpportunities[0].id, {
            StageName: updatedOppStage,
            Amount: updatedOppAmount,
            CloseDate: extraOpportunities[0].payload.CloseDate
        });

        // 12 & 13. Maintain expected relationships and execute multiple SOQL queries.
        failedStep = 'SOQL lifecycle validation';
        const account = await sfApi.getFullSalesLifecycle(primaryAccountId);

        expected = primaryAccountId;
        actual = account.Id;
        expect(actual).toBe(expected);

        const expectedContactIds = [
            primaryJourney.contactId,
            ...extraContacts.map(contact => contact.id)
        ]
            .filter((id): id is string => Boolean(id))
            .sort();
        actual = account.Contacts.records.map((contact: any) => contact.Id).sort();
        expect(actual).toEqual(expectedContactIds);

        const expectedOppIds = [
            primaryJourney.opportunityId,
            ...extraOpportunities.map(opp => opp.id)
        ]
            .filter((id): id is string => Boolean(id))
            .sort();
        actual = account.Opportunities.records.map((opp: any) => opp.Id).sort();
        expect(actual).toEqual(expectedOppIds);

        // 14. Validate the updated Opportunity values through SOQL.
        failedStep = 'Validate Opportunity update through SOQL';
        const updatedOpportunity = account.Opportunities.records.find(
            (opp: any) => opp.Id === extraOpportunities[0].id
        );
        expected = { StageName: updatedOppStage, Amount: updatedOppAmount };
        actual = {
            StageName: updatedOpportunity?.StageName,
            Amount: updatedOpportunity?.Amount
        };
        expect(actual).toEqual(expected);

        // 14. Validate the complete record relationships and business values through REST.
        failedStep = 'Validate lifecycle through REST API';
        const accountRecord = await sfApi.getRecord<any>('Account', primaryAccountId, ['Id', 'Name']);
        const opportunityRecord = await sfApi.getRecord<any>(
            'Opportunity',
            extraOpportunities[0].id,
            ['Id', 'StageName', 'Amount', 'AccountId']
        );

        expect(accountRecord.Name).toBe(primaryJourney.dataset.Company);
        expect(opportunityRecord.StageName).toBe(updatedOppStage);
        expect(opportunityRecord.Amount).toBe(updatedOppAmount);
        expect(opportunityRecord.AccountId).toBe(primaryAccountId);
    } catch (error) {
        // 16. Capture execution ID, record ID, dataset, failed step, expected/actual,
        // screenshot and the API/SOQL error.
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_005',
                failedStep,
                recordId: lastRecordId,
                inputDataset: Array.from(nestedCollection.values()),
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // 17. Perform automated cleanup in reverse dependency order.
        await reconcileTrackedLeads(sfApi, cleanup);
        await cleanup.cleanup();
    }
});
