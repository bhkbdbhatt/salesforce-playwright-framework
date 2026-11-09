/**
 * ============================================================================
 * PDF SCENARIO 5 — "Complete Lead-to-Sales Lifecycle with Dynamic Validation
 * and Recovery"
 * Source: "Week 1 Sceanrios 1.pdf" (Scenario 5)
 * ----------------------------------------------------------------------------
 * Goal: run the full Lead -> Account -> Contact -> Opportunity business flow
 * with dynamic data, backend validation, error reporting and cleanup.
 *
 * Execution engine: writes go through `SalesforceOperations` (API by default,
 * Lightning UI when EXECUTION_MODE='ui'). SOQL / REST reads always use the API.
 *
 * PDF expected-automation step -> code that implements it (demo map):
 *   1. Login ............................. tests/auth.setup.ts
 *   2. Unique execution ID ............... executionId = `LIFECYCLE_${Date.now()}`
 *   3. Multiple Lead datasets ............ datasets = [0,1,2].map(generateLeadData)
 *   4. Create Leads ...................... sfApi.createLead (API or UI)
 *   5. Store data + IDs in collections ... `nestedCollection` Map
 *   6. Condition decides conversion ...... shouldConvert (see CONDITION below)
 *   7. Convert selected Leads ............ sfApi.convertLead -> SOAP/UI
 *   8. Capture Account/Contact/Opp ....... journey.accountId/contactId/oppId
 *   9. Add Contacts to converted Account . extraContacts loop
 *  10. Add Opportunities (varying data) .. extraOpportunities loop
 *  11. Update selected Opportunity ....... sfApi.updateOpportunity
 *  12. Keep expected relationships ....... nestedCollection + extra arrays
 *  13. Multiple SOQL queries ............. getFullSalesLifecycle + REST GET
 *  14. Validate relationships + values ... expect() graph + value checks
 *  15. Track every record for cleanup .... cleanup.track (all creates)
 *  16. Failure diagnostics ............... captureFailure (utils/diagnostics.ts)
 *  17. Cleanup in dependency order ....... reconcileTrackedLeads + cleanup
 *  18. 5 consecutive successful runs ..... npm run test:repeat (--repeat-each=5)
 *
 * CONVERSION CONDITION (PDF step 6): a Lead is converted when its Rating is
 * 'Hot' OR 'Warm'. The first converted Lead becomes the primary Account that
 * the rest of the lifecycle (extra Contacts/Opportunities) is built on.
 * ============================================================================
 */
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

    // PDF step 2 — Generate a unique test-execution ID used to namespace every
    // record and to correlate failure diagnostics.
    const executionId = `LIFECYCLE_${Date.now()}`;
    // PDF steps 5 & 12 — Nested collection holding Lead -> A -> C -> O journeys.
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
        // Salesforce requires an org-configured converted Lead status, so read it
        // from the org instead of hard-coding 'Closed - Converted'.
        const convertedStatus = await sfApi.getConvertedLeadStatus();

        // PDF step 3 — Dynamically generate multiple Lead datasets.
        const datasets = [0, 1, 2].map(index => {
            const data = TestDataGenerator.generateLeadData(index);
            return {
                ...data,
                LastName: `Lifecycle_${executionId}_${index + 1}`,
                Company: `LifecycleCo_${executionId}_${index + 1}`,
                // PDF step 6 — Runtime condition that decides which Leads convert.
                shouldConvert: data.Rating === 'Hot' || data.Rating === 'Warm'
            };
        });

        for (const [index, dataset] of datasets.entries()) {
            // PDF steps 4 & 5 — Create the Lead (API or UI) and store its ID in
            // the nested collection.
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

            // PDF steps 6 & 7 — Convert only the Leads meeting the condition. In
            // 'api' mode this is SOAP convertLead; in 'ui' mode the Lightning flow.
            if (dataset.shouldConvert) {
                failedStep = `Convert Lead ${index + 1} via API`;
                const result = await sfApi.convertLead(leadId, {
                    convertedStatus,
                    opportunityName: `${dataset.Company} Opportunity`
                });
                expect(result.success).toBeTruthy();

                // PDF step 8 — Dynamically capture the generated Account,
                // Contact and Opportunity records on the journey.
                failedStep = `Capture converted records for Lead ${index + 1}`;
                const convertedLead = await sfApi.getLeadStatus(leadId);
                expect(convertedLead.IsConverted).toBeTruthy();

                journey.accountId = result.accountId ?? convertedLead.ConvertedAccountId;
                journey.contactId = result.contactId ?? convertedLead.ConvertedContactId;
                journey.opportunityId = result.opportunityId ?? convertedLead.ConvertedOpportunityId;

                // PDF step 15 — Track every record for cleanup. A converted Lead
                // cannot be deleted, so track its generated records instead.
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

        // PDF step 9 — Add additional Contacts to the converted Account through
        // Playwright (REST in 'api' mode, Lightning UI in 'ui' mode).
        for (let i = 0; i < 2; i++) {
            failedStep = `Add additional Contact ${i + 1} through API`;
            const contactPayload = TestDataGenerator.generateContactData(primaryAccountId);
            contactPayload.LastName = `Secondary_${executionId}_${i + 1}`;
            const contactId = await sfApi.createContact(contactPayload);
            extraContacts.push({ id: contactId, payload: contactPayload });
            cleanup.track('Contact', contactId);
        }

        // PDF step 10 — Create additional Opportunities with varying Stage,
        // Amount and Close Date.
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

        // PDF step 11 — Update a selected Opportunity through Playwright
        // (Lightning UI in 'ui' mode, REST in 'api' mode).
        failedStep = 'Update selected Opportunity through API';
        await sfApi.updateOpportunity(extraOpportunities[0].id, {
            StageName: updatedOppStage,
            Amount: updatedOppAmount,
            CloseDate: extraOpportunities[0].payload.CloseDate
        });

        // PDF steps 12 & 13 — Maintain the expected Lead -> A -> C -> O
        // relationships and execute multiple SOQL queries to read them back.
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

        // PDF step 14 — Validate the updated Opportunity values through SOQL.
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

        // PDF step 14 — Validate the complete record relationships and business
        // values through the backend REST API as an independent second read.
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
        // PDF step 16 — Capture execution ID, Salesforce record ID, input
        // dataset, failed step, expected/actual values, screenshot and the
        // API/SOQL error or response.
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
        // PDF step 17 — Perform automated cleanup in the appropriate dependency
        // order. Converted Leads are expanded into their generated records first.
        await reconcileTrackedLeads(sfApi, cleanup);
        await cleanup.cleanup();
    }
});
