/**
 * ============================================================================
 * PDF SCENARIO 3 — "Data-Driven Lead Creation and Conversion"
 * Source: "Week 1 Sceanrios 1.pdf" (Scenario 3)
 * ----------------------------------------------------------------------------
 * Goal: automate multiple Lead journeys from dynamic data and convert only the
 * Leads whose runtime condition says they are eligible.
 *
 * Execution engine: writes go through `SalesforceOperations` (API by default,
 * Lightning UI when EXECUTION_MODE='ui'). SOQL / REST reads always use the API.
 *
 * PDF expected-automation step -> code that implements it (demo map):
 *   1. Login ............................. tests/auth.setup.ts
 *   2. >= 5 Lead datasets ................ Array.from({length:5}) + generateLeadData
 *   3. Maintain datasets in a Collection . `datasets` array
 *   4. Create Leads dynamically .......... sfApi.createLead (API or UI)
 *   5. Capture Lead IDs in a Map ......... `leadRelationships` Map
 *   6. Condition decides conversion ...... shouldConvert (see CONDITION below)
 *   7. Convert eligible Leads ............ sfApi.convertLead -> SOAP/UI
 *   8. Capture Account/Contact/Opp IDs ... relationship.accountId/contactId/oppId
 *   9. Lead -> A -> C -> O relationships .. `leadRelationships` Map entries
 *  10. SOQL validates converted states ... getLeadStatus + Account sub-queries
 *  11. Validate generated records ........ Account name + linked Contact/Opp
 *  12. Compare UI results with backend ... SOQL vs REST GET cross-check
 *  13. Continue after one dataset fails .. per-dataset try/catch + datasetErrors
 *  14. Failure logs/screenshots/IDs ...... captureFailure (utils/diagnostics.ts)
 *  15. Clean up generated records ........ reconcileTrackedLeads + cleanup
 *  16. 5 consecutive stable executions ... npm run test:repeat (--repeat-each=5)
 *
 * CONVERSION CONDITION (PDF step 6): a Lead is converted when its Rating is
 * 'Hot' OR its Country is 'India'. Everything else stays unconverted so the
 * test can validate both states.
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../services/salesforceServiceFactory';
import type { SalesforceOperations } from '../services/salesforceOperations';
import { TestDataGenerator, LeadData } from '../utils/testDataGenerator';
import { CleanupManager, reconcileTrackedLeads } from '../utils/cleanupManager';
import { captureFailure } from '../utils/diagnostics';

interface LeadDataset extends LeadData {
    shouldConvert: boolean;
}

interface LeadRelationship {
    dataset: LeadDataset;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
}

test('TS_SF_003: Data-Driven Lead Creation and Conversion', async ({ page }, testInfo) => {
    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const executionId = `LEAD_${Date.now()}`;

    // PDF steps 2 & 3 — Build at least 5 Lead datasets with different Lead
    // Source, Industry, Rating and Country combinations, kept in a Collection.
    const datasets: LeadDataset[] = Array.from({ length: 5 }, (_, index) => {
        const data = TestDataGenerator.generateLeadData(index);
        return {
            ...data,
            LastName: `Lead_${executionId}_${index + 1}`,
            Company: `Company_${executionId}_${index + 1}`,
            // PDF step 6 — Predefined runtime condition that decides conversion.
            shouldConvert: data.Rating === 'Hot' || data.Country === 'India'
        };
    });

    const leadRelationships = new Map<string, LeadRelationship>();
    const datasetErrors: string[] = [];
    const validationErrors: string[] = [];

    let failedStep = 'Initialization';
    let lastLeadId: string | undefined;
    let expected: unknown;
    let actual: unknown;

    try {
        // Salesforce requires an org-configured converted Lead status, so read it
        // from the org instead of hard-coding 'Closed - Converted'.
        const convertedStatus = await sfApi.getConvertedLeadStatus();

        // PDF steps 4 & 5 — Create each Lead dynamically and capture its ID in the
        // `leadRelationships` Map, keyed by Lead ID.
        for (const [index, dataset] of datasets.entries()) {
            let leadId: string | undefined;
            try {
                failedStep = `Create Lead ${index + 1}`;
                leadId = await sfApi.createLead({
                    FirstName: dataset.FirstName,
                    LastName: dataset.LastName,
                    Company: dataset.Company,
                    LeadSource: dataset.LeadSource,
                    Industry: dataset.Industry,
                    Rating: dataset.Rating,
                    Country: dataset.Country,
                    Status: dataset.Status
                });
                lastLeadId = leadId;

                const relationship: LeadRelationship = { dataset };
                leadRelationships.set(leadId, relationship);

                // PDF steps 6 & 7 — Only Leads meeting the runtime condition are
                // converted. In 'api' mode this is the SOAP convertLead call; in
                // 'ui' mode it is the Lightning Convert flow.
                if (dataset.shouldConvert) {
                    failedStep = `Convert Lead ${index + 1} via API`;
                    const result = await sfApi.convertLead(leadId, {
                        convertedStatus,
                        opportunityName: `${dataset.Company} Opportunity`
                    });
                    expect(result.success).toBeTruthy();

                    // PDF steps 8 & 9 — Capture the resulting Account, Contact and
                    // Opportunity IDs and keep the Lead -> A -> C -> O relationship.
                    failedStep = `Capture converted records for Lead ${index + 1}`;
                    const convertedLead = await sfApi.getLeadStatus(leadId);
                    expect(
                        convertedLead.IsConverted,
                        `Lead ${leadId} should have been converted`
                    ).toBeTruthy();

                    relationship.accountId = result.accountId ?? convertedLead.ConvertedAccountId;
                    relationship.contactId = result.contactId ?? convertedLead.ConvertedContactId;
                    relationship.opportunityId =
                        result.opportunityId ?? convertedLead.ConvertedOpportunityId;

                    // PDF step 15 — Track in dependency order so reverse cleanup
                    // deletes Opportunity, then Contact, then the Account.
                    cleanup.track('Account', relationship.accountId);
                    cleanup.track('Contact', relationship.contactId);
                    cleanup.track('Opportunity', relationship.opportunityId);
                } else {
                    cleanup.track('Lead', leadId);
                }
            } catch (error) {
                // PDF step 13 — Record this dataset's failure but keep processing
                // the remaining datasets so one bad row does not abort the run.
                datasetErrors.push(
                    `Dataset ${index + 1} (${dataset.Company}): ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );

                if (leadId) {
                    await trackLeadForCleanup(sfApi, cleanup, leadId);
                }
            }
        }

        // PDF steps 10, 11 & 12 — Validate converted and unconverted Lead states
        // plus the generated Account/Contact/Opportunity records through SOQL.
        failedStep = 'SOQL validation of all Lead datasets';
        for (const [leadId, relationship] of leadRelationships.entries()) {
            const { dataset } = relationship;
            const leadRecord = await sfApi.getLeadStatus(leadId);

            if (dataset.shouldConvert) {
                if (!leadRecord.IsConverted) {
                    validationErrors.push(`Lead ${leadId} (${dataset.Company}) was expected to be converted but was not.`);
                    continue;
                }

                const account = await sfApi.queryOne<any>(
                    `SELECT Id, Name, (SELECT Id, LastName FROM Contacts), (SELECT Id, Name FROM Opportunities) FROM Account WHERE Id = '${leadRecord.ConvertedAccountId}'`
                );

                if (account.Name !== dataset.Company) {
                    validationErrors.push(
                        `Lead ${leadId} converted Account name mismatch. Expected "${dataset.Company}", actual "${account.Name}".`
                    );
                }
                if (!account.Contacts.records.some((contact: any) => contact.Id === leadRecord.ConvertedContactId)) {
                    validationErrors.push(
                        `Lead ${leadId} ConvertedContactId ${leadRecord.ConvertedContactId} is not linked to ConvertedAccountId ${leadRecord.ConvertedAccountId}.`
                    );
                }
                if (!account.Opportunities.records.some((opp: any) => opp.Id === leadRecord.ConvertedOpportunityId)) {
                    validationErrors.push(
                        `Lead ${leadId} ConvertedOpportunityId ${leadRecord.ConvertedOpportunityId} is not linked to ConvertedAccountId ${leadRecord.ConvertedAccountId}.`
                    );
                }
            } else {
                if (leadRecord.IsConverted) {
                    validationErrors.push(`Lead ${leadId} (${dataset.Company}) was expected to remain unconverted but was converted.`);
                }
                if (leadRecord.ConvertedAccountId) {
                    validationErrors.push(`Lead ${leadId} unexpectedly has ConvertedAccountId ${leadRecord.ConvertedAccountId}.`);
                }
            }
        }

        // PDF step 12 — Compare the converted Account's backend values with a
        // direct REST API read (independent confirmation of the SOQL result).
        const convertedEntry = Array.from(leadRelationships.entries()).find(
            ([, relationship]) => relationship.dataset.shouldConvert && relationship.accountId
        );
        if (convertedEntry) {
            const [, relationship] = convertedEntry;
            failedStep = 'Compare REST API result against SOQL';
            expected = relationship.dataset.Company;
            const accountRecord = await sfApi.getRecord<any>('Account', relationship.accountId!, [
                'Id',
                'Name'
            ]);
            actual = accountRecord.Name;
            expect(actual).toBe(expected);
        }

        const allErrors = [...datasetErrors, ...validationErrors];
        if (allErrors.length > 0) {
            throw new Error(`One or more Lead datasets failed:\n${allErrors.join('\n')}`);
        }
    } catch (error) {
        // PDF step 14 — Capture logs, screenshots, record IDs and expected/actual
        // values for the failure (utils/diagnostics.ts).
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_003',
                failedStep,
                recordId: lastLeadId,
                inputDataset: datasets,
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // PDF step 15 — Clean up all dynamically generated records. Converted
        // Leads are expanded into their Account/Contact/Opportunity first.
        await reconcileTrackedLeads(sfApi, cleanup);
        await cleanup.cleanup();
    }
});

async function trackLeadForCleanup(
    sfApi: SalesforceOperations,
    cleanup: CleanupManager,
    leadId: string
): Promise<void> {
    try {
        const leadRecord = await sfApi.getLeadStatus(leadId);
        if (leadRecord.IsConverted) {
            cleanup.track('Account', leadRecord.ConvertedAccountId);
            cleanup.track('Contact', leadRecord.ConvertedContactId);
            cleanup.track('Opportunity', leadRecord.ConvertedOpportunityId);
        } else {
            cleanup.track('Lead', leadId);
        }
    } catch {
        cleanup.track('Lead', leadId);
    }
}
