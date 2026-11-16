/**
 * ============================================================================
 * WEEK 2 — SCENARIO 3
 * "Data-Driven Lead Creation and Conditional Conversion"
 * Source: Week2.pdf (Scenario 3)
 * ----------------------------------------------------------------------------
 * Goal: build six Lead datasets, create them dynamically, convert only the
 * eligible Leads, keep the Lead -> Account -> Contact -> Opportunity
 * relationships in a collection, validate converted/unconverted states through
 * SOQL, continue when one dataset fails, and produce a dataset outcome report.
 *
 * Duplicate matching criterion (PDF step 4 & 8): a potential duplicate is a
 * Lead whose Email AND Company match an earlier dataset. This criterion is
 * documented here and enforced by the SOQL duplicate check below.
 *
 * Execution engine: writes use `SalesforceOperations` (API by default,
 * Lightning UI when EXECUTION_MODE=ui). SOQL/REST reads always use the API.
 *
 * PDF expected-automation step -> implementation:
 *   1. Login ............................... tests/auth.setup.ts
 *   2. Unique execution ID ................. createExecutionId('W2S3')
 *   3. >= 6 Lead datasets .................. datasets loop with varied fields
 *   4. 3 eligible + 1 unconverted +
 *      1 invalid + 1 duplicate ............. `kind` field per dataset
 *   5. Store datasets + outcomes ........... `relationships` collection
 *   6. Create Leads + IDs in a Map ......... sfApi.createLead + leadId
 *   7. Regex: email/company/record IDs ..... Email/Company/ID patterns
 *   8. Detect potential duplicates ......... Email + Company SOQL match
 *   9. Duplicate-rule behaviour ............ blocked creation -> rejected status
 *  10. Convert eligible Leads through UI ... sfApi.convertLead (UI in ui mode)
 *  11. Capture Account/Contact/Opp IDs ..... LeadRelationship fields
 *  12. Lead -> A -> C -> O collection ...... relationship entries
 *  13. SOQL for conversion states .......... getLeadStatus + Account subqueries
 *  14. Validate converted/unconverted ...... status and ID checks
 *  15. Validate generated A/C/O values ..... Account name / Contact / Opp checks
 *  16. Compare UI with API/SOQL ............ assertRecordPageShows + REST GET
 *  17. Continue after one failure .......... per-dataset try/catch
 *  18. Report converted/unconverted/
 *      rejected/failed datasets ............ JSON report attached to TestInfo
 *  19. Cleanup + report undeletable Leads .. reconcileTrackedLeads + report
 *  20. Diagnostics + five clean runs ....... captureFailure + npm run test:repeat
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../../services/salesforceServiceFactory';
import type { SalesforceOperations } from '../../services/salesforceOperations';
import { TestDataGenerator, LeadData } from '../../utils/testDataGenerator';
import { CleanupManager, reconcileTrackedLeads } from '../../utils/cleanupManager';
import { captureFailure } from '../../utils/diagnostics';
import {
    assertRecordPageShows,
    createExecutionId,
    escapeSoql,
    expectMatches,
    expectSalesforceId,
    writeJsonReport
} from './support/week2Helpers';

const EXECUTION_ID_PATTERN = /^W2S3_\d{13}_[A-Z0-9]{4}$/;
const LEAD_EMAIL_PATTERN = /^w2s3\.lead\.\d+\.\d{13}@example\.test$/;
const LEAD_COMPANY_PATTERN = /^W2S3_Company_\d+_W2S3_\d{13}_[A-Z0-9]{4}$/;

type LeadKind = 'eligible' | 'unconverted' | 'invalid' | 'duplicate';
type LeadOutcome = 'converted' | 'unconverted' | 'rejected' | 'failed';

interface LeadDataset extends LeadData {
    Email: string;
    kind: LeadKind;
    shouldConvert: boolean;
    expectedOutcome: LeadOutcome;
}

interface LeadRelationship {
    dataset: LeadDataset;
    leadId?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
    status: LeadOutcome | 'pending';
    duplicateDetected?: boolean;
    error?: string;
}

test('TS_SF_W2_003: Data-Driven Lead Creation and Conditional Conversion', async ({
    page
}, testInfo) => {
    test.setTimeout(900000);

    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const executionId = createExecutionId('W2S3');

    expectMatches('Execution ID', executionId, EXECUTION_ID_PATTERN);

    // PDF steps 3, 4 & 5 — six datasets covering converted, unconverted,
    // intentionally invalid and intentionally duplicate rows.
    const datasets: LeadDataset[] = [];

    for (let i = 0; i < 6; i++) {
        const index = i + 1;
        const base = TestDataGenerator.generateLeadData(i);
        const kind: LeadKind =
            i < 3 ? 'eligible' : i === 3 ? 'unconverted' : i === 4 ? 'invalid' : 'duplicate';

        const company = `W2S3_Company_${index}_${executionId}`;
        const email = `w2s3.lead.${index}.${Date.now()}@example.test`;

        const dataset: LeadDataset = {
            ...base,
            LastName: `Lead_${index}_${executionId}`,
            Email: email,
            Company: company,
            LeadSource: ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other', 'Web'][i],
            Industry: ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Technology'][i],
            Rating: i < 3 ? 'Hot' : 'Cold',
            Country: ['India', 'United States', 'United Kingdom', 'Germany', 'Canada', 'India'][i],
            Status: 'Open - Not Contacted',
            kind,
            shouldConvert: kind === 'eligible',
            expectedOutcome:
                kind === 'eligible'
                    ? 'converted'
                    : kind === 'invalid'
                      ? 'rejected'
                      : 'unconverted'
        };

        if (kind === 'invalid') {
            // Intentionally invalid: Salesforce requires Company and LastName.
            dataset.Company = '';
            dataset.LastName = '';
            dataset.Email = 'invalid-email';
        }

        if (kind === 'duplicate') {
            // Documented duplicate criterion: same Email and Company as dataset 1.
            dataset.Company = datasets[0].Company;
            dataset.Email = datasets[0].Email;
            dataset.LastName = `Duplicate_${index}_${executionId}`;
        }

        // PDF step 7 — regex validation of generated Lead emails and companies.
        if (kind === 'invalid') {
            expect(dataset.Email).not.toMatch(LEAD_EMAIL_PATTERN);
            expect(dataset.Company).not.toMatch(LEAD_COMPANY_PATTERN);
        } else {
            expectMatches(`Lead ${index} email`, dataset.Email, LEAD_EMAIL_PATTERN);
            expectMatches(`Lead ${index} company`, dataset.Company, LEAD_COMPANY_PATTERN);
        }

        datasets.push(dataset);
    }

    const relationships: LeadRelationship[] = [];
    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let lastLeadId: string | undefined;

    try {
        const convertedStatus = await sfApi.getConvertedLeadStatus();

        // PDF steps 6, 8, 9, 10, 11 & 12 — create each Lead, detect potential
        // duplicates and convert only the eligible datasets. Each dataset has
        // its own try/catch so one failure does not stop the remaining rows.
        for (const [index, dataset] of datasets.entries()) {
            const relationship: LeadRelationship = { dataset, status: 'pending' };
            relationships.push(relationship);

            try {
                failedStep = `Create Lead dataset ${index + 1} (${dataset.kind})`;

                if (dataset.kind === 'invalid') {
                    // An invalid dataset must be rejected. If it is created, the
                    // dataset is reported as failed and tracked for cleanup.
                    try {
                        const accidentalLeadId = await sfApi.createLead({
                            FirstName: dataset.FirstName,
                            LastName: dataset.LastName,
                            Company: dataset.Company,
                            Email: dataset.Email,
                            LeadSource: dataset.LeadSource,
                            Industry: dataset.Industry,
                            Rating: dataset.Rating,
                            Country: dataset.Country,
                            Status: dataset.Status
                        });
                        relationship.leadId = accidentalLeadId;
                        relationship.status = 'failed';
                        relationship.error =
                            'Intentionally invalid Lead dataset was accepted by Salesforce.';
                        lastLeadId = accidentalLeadId;
                        cleanup.track('Lead', accidentalLeadId);
                    } catch (error) {
                        relationship.status = 'rejected';
                        relationship.error =
                            error instanceof Error ? error.message : String(error);
                    }
                    continue;
                }

                const leadId = await sfApi.createLead({
                    FirstName: dataset.FirstName,
                    LastName: dataset.LastName,
                    Company: dataset.Company,
                    Email: dataset.Email,
                    LeadSource: dataset.LeadSource,
                    Industry: dataset.Industry,
                    Rating: dataset.Rating,
                    Country: dataset.Country,
                    Status: dataset.Status
                });

                expectSalesforceId(`Lead dataset ${index + 1} ID`, leadId);
                relationship.leadId = leadId;
                lastLeadId = leadId;
                cleanup.track('Lead', leadId);

                // PDF steps 8 & 9 — potential duplicate detection using the
                // documented Email + Company criterion. If the org's duplicate
                // rules block creation, the catch below records a rejected row.
                if (dataset.kind === 'duplicate') {
                    failedStep = `Detect duplicate for Lead dataset ${index + 1}`;
                    const matches = await sfApi.queryRecords<any>(
                        `SELECT Id, Email, Company FROM Lead ` +
                            `WHERE Email = '${escapeSoql(dataset.Email)}' ` +
                            `AND Company = '${escapeSoql(dataset.Company)}'`
                    );

                    relationship.duplicateDetected = matches.length >= 2;
                    relationship.status = 'unconverted';

                    if (matches.length < 2) {
                        relationship.status = 'failed';
                        relationship.error =
                            'Potential duplicate was not detected by the Email + Company criterion.';
                    }
                    continue;
                }

                if (dataset.shouldConvert) {
                    // PDF steps 10, 11 & 12 — convert through the configured
                    // engine (Lightning UI in UI mode, SOAP in API mode), then
                    // capture the generated Account, Contact and Opportunity.
                    failedStep = `Convert Lead dataset ${index + 1}`;
                    const result = await sfApi.convertLead(leadId, {
                        convertedStatus,
                        opportunityName: `${dataset.Company} Opportunity`
                    });

                    expect(result.success, `Lead ${leadId} should convert`).toBeTruthy();

                    const convertedLead = await sfApi.getLeadStatus(leadId);
                    expect(convertedLead.IsConverted).toBeTruthy();

                    relationship.accountId =
                        result.accountId ?? convertedLead.ConvertedAccountId;
                    relationship.contactId =
                        result.contactId ?? convertedLead.ConvertedContactId;
                    relationship.opportunityId =
                        result.opportunityId ?? convertedLead.ConvertedOpportunityId;
                    relationship.status = 'converted';

                    expectSalesforceId('Converted Account ID', relationship.accountId!);
                    expectSalesforceId('Converted Contact ID', relationship.contactId!);

                    // A converted Lead cannot be deleted. Remove it from the
                    // cleanup list and track the generated records instead.
                    cleanup.untrack('Lead', leadId);
                    cleanup.track('Account', relationship.accountId);
                    cleanup.track('Contact', relationship.contactId);
                    cleanup.track('Opportunity', relationship.opportunityId);
                } else {
                    relationship.status = 'unconverted';
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                if (dataset.kind === 'duplicate' && /duplicate/i.test(message)) {
                    // PDF step 9 — a duplicate rule blocked the row. This is a
                    // valid, expected outcome and is reported as rejected.
                    relationship.status = 'rejected';
                    relationship.error = message;
                } else {
                    relationship.status = 'failed';
                    relationship.error = message;
                }

                if (relationship.leadId) {
                    await trackLeadForCleanup(sfApi, cleanup, relationship.leadId);
                }
            }
        }

        // PDF steps 13, 14 & 15 — validate conversion states and generated
        // Account/Contact/Opportunity values through SOQL.
        failedStep = 'SOQL validation of all Lead datasets';
        const issues: string[] = [];

        for (const relationship of relationships) {
            const { dataset, leadId, status } = relationship;

            if (!leadId) {
                if (status === 'rejected') {
                    continue;
                }
                issues.push(`${dataset.Company}: no Lead ID was captured (${status}).`);
                continue;
            }

            const leadRecord = await sfApi.getLeadStatus(leadId);

            if (status === 'converted') {
                if (!leadRecord.IsConverted) {
                    issues.push(
                        `${dataset.Company}: expected a converted Lead but IsConverted is false.`
                    );
                    continue;
                }

                const account = await sfApi.queryOne<any>(
                    `SELECT Id, Name, ` +
                        `(SELECT Id, FirstName, LastName, Email FROM Contacts), ` +
                        `(SELECT Id, Name FROM Opportunities) ` +
                        `FROM Account WHERE Id = '${leadRecord.ConvertedAccountId}'`
                );

                if (account.Name !== dataset.Company) {
                    issues.push(
                        `${dataset.Company}: converted Account name is "${account.Name}".`
                    );
                }

                if (
                    !account.Contacts.records.some(
                        (contact: any) => contact.Id === leadRecord.ConvertedContactId
                    )
                ) {
                    issues.push(
                        `${dataset.Company}: ConvertedContactId ${leadRecord.ConvertedContactId} is not linked to the converted Account.`
                    );
                }

                if (
                    !account.Opportunities.records.some(
                        (opportunity: any) => opportunity.Id === leadRecord.ConvertedOpportunityId
                    )
                ) {
                    issues.push(
                        `${dataset.Company}: ConvertedOpportunityId ${leadRecord.ConvertedOpportunityId} is not linked to the converted Account.`
                    );
                }

                const convertedContact = account.Contacts.records.find(
                    (contact: any) => contact.Id === leadRecord.ConvertedContactId
                );

                if (convertedContact && convertedContact.LastName !== dataset.LastName) {
                    issues.push(
                        `${dataset.Company}: converted Contact LastName "${convertedContact.LastName}" does not match Lead LastName "${dataset.LastName}".`
                    );
                }

                expect(relationship.accountId).toBe(leadRecord.ConvertedAccountId);
                expect(relationship.contactId).toBe(leadRecord.ConvertedContactId);
                expect(relationship.opportunityId).toBe(leadRecord.ConvertedOpportunityId);
            } else {
                if (leadRecord.IsConverted) {
                    issues.push(
                        `${dataset.Company}: expected an unconverted Lead but IsConverted is true.`
                    );
                }

                if (leadRecord.ConvertedAccountId) {
                    issues.push(
                        `${dataset.Company}: unconverted Lead has ConvertedAccountId ${leadRecord.ConvertedAccountId}.`
                    );
                }
            }
        }

        // PDF step 16 — compare the converted Account UI with the SOQL/API
        // result. UI mode already created the records through Lightning; this
        // step independently confirms the detail page shows the same values.
        const firstConverted = relationships.find(
            relationship => relationship.status === 'converted' && relationship.accountId
        );

        if (firstConverted?.accountId) {
            failedStep = 'Compare converted Account UI with SOQL/API';
            await assertRecordPageShows(page, 'Account', firstConverted.accountId, [
                firstConverted.dataset.Company
            ]);

            expected = firstConverted.dataset.Company;
            const accountRecord = await sfApi.getRecord<any>(
                'Account',
                firstConverted.accountId,
                ['Id', 'Name']
            );
            actual = accountRecord.Name;
            expect(actual).toBe(expected);
        }

        // PDF step 18 — build the converted/unconverted/rejected/failed report.
        const summary = {
            converted: relationships.filter(item => item.status === 'converted').length,
            unconverted: relationships.filter(item => item.status === 'unconverted').length,
            rejected: relationships.filter(item => item.status === 'rejected').length,
            failed: relationships.filter(item => item.status === 'failed').length
        };

        await writeJsonReport(
            testInfo,
            `TS_SF_W2_003-${executionId}-report.json`,
            {
                executionId,
                duplicateCriterion: 'Same Email AND same Company as an earlier Lead dataset',
                summary,
                datasets: relationships.map(item => ({
                    kind: item.dataset.kind,
                    company: item.dataset.Company,
                    email: item.dataset.Email,
                    expectedOutcome: item.dataset.expectedOutcome,
                    status: item.status,
                    leadId: item.leadId ?? null,
                    accountId: item.accountId ?? null,
                    contactId: item.contactId ?? null,
                    opportunityId: item.opportunityId ?? null,
                    duplicateDetected: item.duplicateDetected ?? false,
                    error: item.error ?? null,
                    // Converted Leads cannot be deleted; their generated
                    // records are the cleanup target instead.
                    convertedLeadCannotBeDeleted: item.status === 'converted'
                }))
            }
        );

        const failedRelationships = relationships.filter(item => item.status === 'failed');

        if (issues.length > 0 || failedRelationships.length > 0) {
            expected = 'all unexpected datasets reported no issues';
            actual = {
                issues,
                failed: failedRelationships.map(item => ({
                    company: item.dataset.Company,
                    error: item.error
                }))
            };
            throw new Error(
                `Lead dataset validation failed:\n${issues.join('\n')}\n${failedRelationships
                    .map(item => `${item.dataset.Company}: ${item.error}`)
                    .join('\n')}`
            );
        }
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_W2_003',
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
        // PDF step 19 — delete unconverted Leads and expand any converted Lead
        // into its generated Account/Contact/Opportunity before cleanup.
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
            cleanup.untrack('Lead', leadId);
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
