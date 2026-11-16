/**
 * ============================================================================
 * WEEK 2 — SCENARIO 5
 * "Parallel Lead-to-Sales Lifecycle with Recovery"
 * Source: Week2.pdf (Scenario 5)
 * ----------------------------------------------------------------------------
 * Goal: run five Lead journeys, at least three concurrently in isolated
 * Playwright browser contexts. Each eligible Lead is converted, receives two
 * extra Contacts and two extra Opportunities, and selected Contacts are linked
 * through Opportunity Contact Roles. One journey is intentionally invalid, one
 * is interrupted after Lead creation and resumed from its stored ID, and one
 * hits a recoverable failure. A journey-level report captures every outcome.
 *
 * Execution engine: writes use `SalesforceOperations` (API by default,
 * Lightning UI when EXECUTION_MODE=ui). Each concurrent journey gets its own
 * browser context and its own service instance, so records can never leak
 * between journeys. SOQL/REST reads always use the API.
 *
 * PDF expected-automation step -> implementation:
 *   1. Login ............................... tests/auth.setup.ts
 *   2. Suite + >= 5 journey IDs ............. suiteExecutionId + _J1.._J5
 *   3. Five Lead datasets ................... `journeys` with varied fields
 *   4. >= 3 concurrent isolated contexts .... runWithConcurrency(limit=3)
 *   5. Separate collection per journey ...... JourneyRecord arrays/IDs
 *   6. Create Leads with Playwright API ..... service.createLead
 *   7. Convert eligible Leads through UI .... service.convertLead (UI in ui mode)
 *   8. Capture Account/Contact/Opp IDs ...... journey.accountId/contactId/opId
 *   9. +2 Contacts and +2 Opportunities ..... extraContacts/extraOpportunities
 *  10. Link Contacts via Contact Roles ...... OpportunityContactRole create
 *  11. Update selected Opportunity .......... service.updateOpportunity
 *  12. Regex: IDs/names/emails/record IDs ... test patterns + expectMatches
 *  13. Controlled failures .................. invalid, interruption, recoverable
 *  14. Continue unaffected journeys ......... per-journey try/catch
 *  15. Resume interrupted via stored ID ..... resumeJourney + getLeadStatus
 *  16. SOQL for Leads/A/C/O/Roles ........... per-journey relationship queries
 *  17. Validate no mixing/missing/duplicates  collection equality + global ID set
 *  18. Journey-level report ................. JSON report attached to TestInfo
 *  19. Cleanup completed + partial journeys . per-journey cleanup in finally
 *  20. Diagnostics + five clean runs ........ captureFailure + npm run test:repeat
 * ============================================================================
 */
import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import { resolveExecutionMode } from '../../config/execution.config';
import { createSalesforceService } from '../../services/salesforceServiceFactory';
import type { SalesforceOperations } from '../../services/salesforceOperations';
import { TestDataGenerator, LeadData } from '../../utils/testDataGenerator';
import { CleanupManager, reconcileTrackedLeads } from '../../utils/cleanupManager';
import { captureFailure } from '../../utils/diagnostics';
import {
    collectCollectionIssues,
    createExecutionId,
    expectMatches,
    expectSalesforceId,
    futureDateIso,
    writeJsonReport
} from './support/week2Helpers';

const EXECUTION_ID_PATTERN = /^W2S5_\d{13}_[A-Z0-9]{4}$/;
const JOURNEY_ID_PATTERN = /^W2S5_\d{13}_[A-Z0-9]{4}_J\d+$/;
const LEAD_EMAIL_PATTERN = /^w2s5\.lead\.\d+\.\d+@example\.test$/;

type JourneyFailureMode = 'none' | 'invalid' | 'interruption' | 'recoverable';
type JourneyStatus =
    | 'pending'
    | 'converted'
    | 'unconverted'
    | 'interrupted'
    | 'recovered'
    | 'failed';

interface JourneyDataset extends LeadData {
    Email: string;
    shouldConvert: boolean;
    failureMode: JourneyFailureMode;
}

interface JourneyRecord {
    journeyId: string;
    dataset: JourneyDataset;
    leadId?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
    extraContactIds: string[];
    extraOpportunityIds: string[];
    contactRoleIds: string[];
    updatedOpportunityId?: string;
    expectedUpdatedStage?: string;
    expectedUpdatedAmount?: number;
    status: JourneyStatus;
    errors: string[];
    recoveryAttempts: string[];
    cleanupStatus?: string;
    cleanupErrors?: string[];
    cleanup?: CleanupManager;
    service?: SalesforceOperations;
    page?: Page;
    context?: BrowserContext;
}

test('TS_SF_W2_005: Parallel Lead-to-Sales Lifecycle with Recovery', async ({
    page,
    browser
}, testInfo) => {
    test.setTimeout(1500000);

    const mainService = createSalesforceService(page);
    const suiteExecutionId = createExecutionId('W2S5');
    expectMatches('Suite execution ID', suiteExecutionId, EXECUTION_ID_PATTERN);

    const convertedStatus = await mainService.getConvertedLeadStatus();

    // PDF steps 2, 3 & 5 — five journey datasets, each with its own collection.
    const journeys: JourneyRecord[] = [];

    for (let i = 1; i <= 5; i++) {
        const journeyId = `${suiteExecutionId}_J${i}`;
        const index = i;

        expectMatches(`Journey ${i} ID`, journeyId, JOURNEY_ID_PATTERN);

        const base = TestDataGenerator.generateLeadData(i - 1);
        const failureMode: JourneyFailureMode =
            i === 1 ? 'invalid' : i === 2 ? 'interruption' : i === 3 ? 'recoverable' : 'none';
        const shouldConvert = i === 2 || i === 3 || i === 4;

        const dataset: JourneyDataset = {
            ...base,
            LastName: `W2S5_Lead_${index}_${suiteExecutionId}`,
            Company:
                failureMode === 'invalid' ? '' : `W2S5_Company_${index}_${suiteExecutionId}`,
            Email: `w2s5.lead.${index}.${Date.now()}@example.test`,
            Status: 'Open - Not Contacted',
            LeadSource: ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'][i - 1],
            Industry: ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing'][i - 1],
            Rating: shouldConvert ? 'Hot' : 'Cold',
            Country: ['India', 'United States', 'United Kingdom', 'Germany', 'Canada'][i - 1],
            shouldConvert,
            failureMode
        };

        if (failureMode === 'invalid') {
            dataset.LastName = '';
            dataset.Email = 'invalid-email';
        } else {
            expectMatches(`Journey ${i} Lead email`, dataset.Email, LEAD_EMAIL_PATTERN);
        }

        journeys.push({
            journeyId,
            dataset,
            extraContactIds: [],
            extraOpportunityIds: [],
            contactRoleIds: [],
            status: 'pending',
            errors: [],
            recoveryAttempts: []
        });
    }

    const validationIssues: string[] = [];
    let fatal: unknown;

    try {
        // PDF steps 4, 6, 7, 8, 9, 10, 11, 13 & 14 — process at least three
        // journeys concurrently, each in an isolated browser context.
        await runWithConcurrency(journeys, 3, journey =>
            runJourney(browser, journey, convertedStatus)
        );

        // PDF step 15 — resume the interrupted journey from the stored Lead ID
        // and reconcile it through SOQL before continuing.
        for (const journey of journeys.filter(item => item.status === 'interrupted')) {
            await resumeJourney(journey, convertedStatus);
        }

        validationIssues.push(...(await validateJourneys(journeys)));
    } catch (error) {
        fatal = error;
    }

    // PDF step 19 — cleanup completed and partially completed journeys while
    // their contexts are still open, so UI-mode cleanup can use Lightning.
    await cleanupJourneys(journeys);

    // PDF step 18 — attach the journey-level report with final statuses.
    try {
        await writeJsonReport(
            testInfo,
            `TS_SF_W2_005-${suiteExecutionId}-journey-report.json`,
            {
                suiteExecutionId,
                executionMode: resolveExecutionMode(),
                journeys: journeys.map(journey => ({
                    journeyId: journey.journeyId,
                    failureMode: journey.dataset.failureMode,
                    expectedFailure: journey.dataset.failureMode === 'invalid',
                    shouldConvert: journey.dataset.shouldConvert,
                    company: journey.dataset.Company,
                    email: journey.dataset.Email,
                    status: journey.status,
                    leadId: journey.leadId ?? null,
                    accountId: journey.accountId ?? null,
                    contactId: journey.contactId ?? null,
                    opportunityId: journey.opportunityId ?? null,
                    extraContactIds: journey.extraContactIds,
                    extraOpportunityIds: journey.extraOpportunityIds,
                    contactRoleIds: journey.contactRoleIds,
                    updatedOpportunityId: journey.updatedOpportunityId ?? null,
                    expectedUpdatedStage: journey.expectedUpdatedStage ?? null,
                    expectedUpdatedAmount: journey.expectedUpdatedAmount ?? null,
                    recoveryAttempts: journey.recoveryAttempts,
                    errors: journey.errors,
                    cleanupStatus: journey.cleanupStatus ?? null,
                    cleanupErrors: journey.cleanupErrors ?? []
                }))
            }
        );
    } catch (error) {
        if (!fatal) {
            fatal = error;
        }
    }

    await closeJourneyContexts(journeys);

    if (!fatal && validationIssues.length > 0) {
        fatal = new Error(`Parallel lifecycle validation failed:\n${validationIssues.join('\n')}`);
    }

    if (fatal) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId: suiteExecutionId,
                testName: 'TS_SF_W2_005',
                failedStep: 'Parallel journey processing and validation',
                recordId: journeys.find(journey => journey.accountId)?.accountId,
                inputDataset: journeys.map(journey => ({
                    journeyId: journey.journeyId,
                    dataset: journey.dataset,
                    status: journey.status,
                    errors: journey.errors
                })),
                expected: 'all journeys isolated, recovered and validated',
                actual: validationIssues
            },
            fatal
        );
        throw fatal;
    }
});

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let nextIndex = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) {
                return;
            }
            await worker(items[currentIndex]);
        }
    });

    await Promise.all(runners);
}

async function runJourney(
    browser: Browser,
    journey: JourneyRecord,
    convertedStatus: string
): Promise<void> {
    const context = await browser.newContext({
        baseURL: process.env.SF_BASE_URL || 'https://login.salesforce.com',
        storageState: path.join(process.cwd(), '.auth', 'user.json')
    });
    const page = await context.newPage();
    const service = createSalesforceService(page);
    const cleanup = new CleanupManager(service);

    journey.context = context;
    journey.page = page;
    journey.service = service;
    journey.cleanup = cleanup;

    const dataset = journey.dataset;

    try {
        // PDF step 13 — one intentionally invalid dataset.
        if (dataset.failureMode === 'invalid') {
            journey.recoveryAttempts.push('Expected invalid dataset rejection');

            try {
                const accidentalLeadId = await service.createLead({
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
                journey.leadId = accidentalLeadId;
                cleanup.track('Lead', accidentalLeadId);
                journey.status = 'failed';
                journey.errors.push('Intentionally invalid journey dataset was accepted.');
            } catch (error) {
                journey.status = 'failed';
                journey.errors.push(
                    `Expected invalid dataset failure: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
            return;
        }

        // PDF steps 6 & 8 — create the Lead and keep its ID in this journey's
        // collection only.
        const leadId = await service.createLead({
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

        expectSalesforceId(`Journey ${journey.journeyId} Lead ID`, leadId);
        journey.leadId = leadId;
        cleanup.track('Lead', leadId);

        // PDF step 13 — one simulated interruption after a record exists.
        if (dataset.failureMode === 'interruption') {
            journey.recoveryAttempts.push('Simulated interruption after Lead creation');
            journey.status = 'interrupted';
            return;
        }

        await completeJourney(journey, service, cleanup, convertedStatus);
    } catch (error) {
        journey.status = 'failed';
        journey.errors.push(error instanceof Error ? error.message : String(error));
    }
}

async function resumeJourney(
    journey: JourneyRecord,
    convertedStatus: string
): Promise<void> {
    if (!journey.service || !journey.cleanup || !journey.leadId) {
        journey.status = 'failed';
        journey.errors.push('Interrupted journey cannot be resumed without a service and Lead ID.');
        return;
    }

    try {
        journey.recoveryAttempts.push(
            'Resuming interrupted journey using the stored Lead ID and SOQL reconciliation'
        );

        const lead = await journey.service.getLeadStatus(journey.leadId);
        expectSalesforceId(`Journey ${journey.journeyId} stored Lead ID`, lead.Id);

        await completeJourney(journey, journey.service, journey.cleanup, convertedStatus);
        journey.status = 'recovered';
        journey.recoveryAttempts.push('Interrupted journey resumed successfully');
    } catch (error) {
        journey.status = 'failed';
        journey.errors.push(error instanceof Error ? error.message : String(error));
    }
}

async function completeJourney(
    journey: JourneyRecord,
    service: SalesforceOperations,
    cleanup: CleanupManager,
    convertedStatus: string
): Promise<void> {
    const dataset = journey.dataset;

    if (!dataset.shouldConvert) {
        journey.status = 'unconverted';
        return;
    }

    if (!journey.accountId || !journey.contactId || !journey.opportunityId) {
        // PDF steps 7 & 8 — convert through the configured engine and capture
        // the generated Account, Contact and Opportunity IDs.
        const lead = await service.getLeadStatus(journey.leadId!);

        if (lead.IsConverted) {
            journey.accountId = lead.ConvertedAccountId;
            journey.contactId = lead.ConvertedContactId;
            journey.opportunityId = lead.ConvertedOpportunityId;
        } else {
            const result = await service.convertLead(journey.leadId!, {
                convertedStatus,
                opportunityName: `${dataset.Company} Opportunity`
            });

            expect(result.success, `Journey ${journey.journeyId} Lead should convert`).toBeTruthy();

            const convertedLead = await service.getLeadStatus(journey.leadId!);
            expect(convertedLead.IsConverted).toBeTruthy();

            journey.accountId = result.accountId ?? convertedLead.ConvertedAccountId;
            journey.contactId = result.contactId ?? convertedLead.ConvertedContactId;
            journey.opportunityId = result.opportunityId ?? convertedLead.ConvertedOpportunityId;
        }

        expectSalesforceId(`Journey ${journey.journeyId} Account ID`, journey.accountId!);
        expectSalesforceId(`Journey ${journey.journeyId} Contact ID`, journey.contactId!);

        cleanup.untrack('Lead', journey.leadId);
        cleanup.track('Account', journey.accountId);
        cleanup.track('Contact', journey.contactId);
        cleanup.track('Opportunity', journey.opportunityId);
        journey.status = 'converted';
    }

    if (!journey.accountId) {
        throw new Error(`Journey ${journey.journeyId} has no converted Account.`);
    }

    const accountId = journey.accountId;

    // PDF step 9 — two additional Contacts through the configured engine.
    if (journey.extraContactIds.length === 0) {
        for (let i = 1; i <= 2; i++) {
            const contactPayload = TestDataGenerator.generateContactData(accountId);
            contactPayload.FirstName = 'W2S5';
            contactPayload.LastName = `W2S5_ExtraContact_${i}_${journey.journeyId}`;
            contactPayload.Email = `w2s5.extra.${journey.journeyId.toLowerCase()}.${i}@example.test`;

            const contactId = await service.createContact(contactPayload);
            expectSalesforceId(`Journey ${journey.journeyId} extra Contact ${i}`, contactId);
            journey.extraContactIds.push(contactId);
            cleanup.track('Contact', contactId);
        }
    }

    // PDF step 9 — two additional Opportunities with different stages,
    // amounts and close dates.
    if (journey.extraOpportunityIds.length === 0) {
        const stages = ['Value Proposition', 'Id. Decision Makers'];

        for (let i = 0; i < 2; i++) {
            const oppPayload = TestDataGenerator.generateOpportunityData(
                accountId,
                45 + i * 20
            );
            oppPayload.Name = `W2S5_ExtraOpp_${i + 1}_${journey.journeyId}`;
            oppPayload.StageName = stages[i];
            oppPayload.Amount = 25000 * (i + 1);
            oppPayload.CloseDate = futureDateIso(45 + i * 20);

            const opportunityId = await service.createOpportunity(oppPayload);
            expectSalesforceId(
                `Journey ${journey.journeyId} extra Opportunity ${i + 1}`,
                opportunityId
            );
            journey.extraOpportunityIds.push(opportunityId);
            cleanup.track('Opportunity', opportunityId);
        }
    }

    // PDF step 10 — associate selected Contacts with Opportunities using
    // Opportunity Contact Roles.
    if (journey.contactRoleIds.length === 0) {
        for (let i = 0; i < Math.min(journey.extraContactIds.length, journey.extraOpportunityIds.length); i++) {
            const contactRoleId = await service.createRecord('OpportunityContactRole', {
                OpportunityId: journey.extraOpportunityIds[i],
                ContactId: journey.extraContactIds[i],
                Role: 'Decision Maker',
                IsPrimary: i === 0
            });
            expectSalesforceId(`Journey ${journey.journeyId} Contact Role ${i + 1}`, contactRoleId);
            journey.contactRoleIds.push(contactRoleId);
            cleanup.track('OpportunityContactRole', contactRoleId);
        }
    }

    // PDF steps 11 & 13 — introduce one recoverable failure for the selected
    // journey, then update the selected Opportunity through the active engine.
    if (!journey.updatedOpportunityId) {
        if (
            dataset.failureMode === 'recoverable' &&
            !journey.recoveryAttempts.includes('controlled-failure-triggered')
        ) {
            journey.recoveryAttempts.push('controlled-failure-triggered');

            try {
                if (resolveExecutionMode() === 'api') {
                    // A real API failure: this record ID has a valid format but
                    // does not exist in the org.
                    await service.updateOpportunity('001000000000000AAA', { Amount: 1 });
                } else {
                    // A controlled browser failure, introduced by the test.
                    throw new Error('Simulated browser failure before the Opportunity update.');
                }

                journey.errors.push('The controlled recoverable failure did not occur.');
            } catch (error) {
                journey.recoveryAttempts.push(
                    `Recovered after controlled failure: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        const targetOpportunityId = journey.extraOpportunityIds[0];
        const updatedStage = 'Negotiation/Review';
        const updatedAmount = 65432;
        const updatedCloseDate = futureDateIso(90);

        await service.updateOpportunity(targetOpportunityId, {
            StageName: updatedStage,
            Amount: updatedAmount,
            CloseDate: updatedCloseDate
        });

        journey.updatedOpportunityId = targetOpportunityId;
        journey.expectedUpdatedStage = updatedStage;
        journey.expectedUpdatedAmount = updatedAmount;
    }
}

async function validateJourneys(journeys: JourneyRecord[]): Promise<string[]> {
    const issues: string[] = [];
    const usedAccountIds = new Set<string>();
    const usedRecordIds = new Set<string>();

    for (const journey of journeys) {
        // PDF step 13 — the invalid journey is an expected controlled failure.
        if (journey.dataset.failureMode === 'invalid') {
            if (journey.status !== 'failed') {
                issues.push(`Journey ${journey.journeyId}: invalid dataset was not rejected.`);
            }
            if (journey.accountId) {
                issues.push(`Journey ${journey.journeyId}: invalid dataset created an Account.`);
            }
            continue;
        }

        if (journey.status === 'failed') {
            issues.push(
                `Journey ${journey.journeyId}: ${journey.errors.join('; ') || 'unknown failure'}`
            );
            continue;
        }

        if (journey.status === 'interrupted') {
            issues.push(`Journey ${journey.journeyId}: interruption was not resumed.`);
            continue;
        }

        const service = journey.service;

        if (!service || !journey.leadId) {
            issues.push(`Journey ${journey.journeyId}: missing service or Lead ID.`);
            continue;
        }

        const lead = await service.getLeadStatus(journey.leadId);

        if (!journey.dataset.shouldConvert) {
            if (lead.IsConverted) {
                issues.push(`Journey ${journey.journeyId}: Lead should remain unconverted.`);
            }
            if (journey.status !== 'unconverted') {
                issues.push(
                    `Journey ${journey.journeyId}: expected status unconverted, got ${journey.status}.`
                );
            }
            continue;
        }

        if (!lead.IsConverted) {
            issues.push(`Journey ${journey.journeyId}: eligible Lead was not converted.`);
            continue;
        }

        const accountId = journey.accountId ?? lead.ConvertedAccountId;
        const contactId = journey.contactId ?? lead.ConvertedContactId;
        const opportunityId = journey.opportunityId ?? lead.ConvertedOpportunityId;

        if (!accountId) {
            issues.push(`Journey ${journey.journeyId}: no converted Account ID.`);
            continue;
        }

        if (usedAccountIds.has(accountId)) {
            issues.push(`Journey ${journey.journeyId}: Account ${accountId} is used by another journey.`);
        }
        usedAccountIds.add(accountId);

        const account = await service.queryOne<any>(
            `SELECT Id, Name, ` +
                `(SELECT Id, LastName FROM Contacts), ` +
                `(SELECT Id, Name FROM Opportunities) ` +
                `FROM Account WHERE Id = '${accountId}'`
        );

        if (account.Name !== journey.dataset.Company) {
            issues.push(
                `Journey ${journey.journeyId}: Account name "${account.Name}" does not match "${journey.dataset.Company}".`
            );
        }

        const expectedContactIds = [contactId, ...journey.extraContactIds].filter(
            (id): id is string => Boolean(id)
        );
        const expectedOpportunityIds = [opportunityId, ...journey.extraOpportunityIds].filter(
            (id): id is string => Boolean(id)
        );

        issues.push(
            ...collectCollectionIssues(
                `Journey ${journey.journeyId} contacts`,
                expectedContactIds,
                account.Contacts.records.map((contact: any) => contact.Id)
            )
        );
        issues.push(
            ...collectCollectionIssues(
                `Journey ${journey.journeyId} opportunities`,
                expectedOpportunityIds,
                account.Opportunities.records.map((opportunity: any) => opportunity.Id)
            )
        );

        for (const recordId of [accountId, ...expectedContactIds, ...expectedOpportunityIds]) {
            if (usedRecordIds.has(recordId)) {
                issues.push(
                    `Journey ${journey.journeyId}: record ${recordId} is shared with another journey.`
                );
            }
            usedRecordIds.add(recordId);
        }

        // PDF step 17 — each journey's records belong to that journey only.
        const extraContacts = account.Contacts.records.filter((contact: any) =>
            journey.extraContactIds.includes(contact.Id)
        );
        const extraOpportunities = account.Opportunities.records.filter((opportunity: any) =>
            journey.extraOpportunityIds.includes(opportunity.Id)
        );

        for (const contact of extraContacts) {
            if (!String(contact.LastName).includes(journey.journeyId)) {
                issues.push(
                    `Journey ${journey.journeyId}: Contact ${contact.Id} is not named for this journey.`
                );
            }
        }
        for (const opportunity of extraOpportunities) {
            if (!String(opportunity.Name).includes(journey.journeyId)) {
                issues.push(
                    `Journey ${journey.journeyId}: Opportunity ${opportunity.Id} is not named for this journey.`
                );
            }
        }

        if (journey.updatedOpportunityId) {
            const contactRoles = await service.queryRecords<any>(
                `SELECT Id, ContactId, OpportunityId FROM OpportunityContactRole ` +
                    `WHERE OpportunityId = '${journey.updatedOpportunityId}'`
            );

            issues.push(
                ...collectCollectionIssues(
                    `Journey ${journey.journeyId} contact roles`,
                    journey.contactRoleIds,
                    contactRoles.map((role: any) => role.Id)
                )
            );

            for (const role of contactRoles) {
                if (!journey.extraContactIds.includes(role.ContactId)) {
                    issues.push(
                        `Journey ${journey.journeyId}: Contact Role ${role.Id} links Contact ${role.ContactId} from another journey.`
                    );
                }
            }

            const updatedOpportunity = await service.getRecord<any>(
                'Opportunity',
                journey.updatedOpportunityId,
                ['Id', 'StageName', 'Amount']
            );

            if (updatedOpportunity.StageName !== journey.expectedUpdatedStage) {
                issues.push(
                    `Journey ${journey.journeyId}: Opportunity Stage "${updatedOpportunity.StageName}" does not match "${journey.expectedUpdatedStage}".`
                );
            }
            if (
                Number(updatedOpportunity.Amount) !== Number(journey.expectedUpdatedAmount)
            ) {
                issues.push(
                    `Journey ${journey.journeyId}: Opportunity Amount ${updatedOpportunity.Amount} does not match ${journey.expectedUpdatedAmount}.`
                );
            }
        }

        if (journey.errors.length > 0) {
            issues.push(`Journey ${journey.journeyId}: ${journey.errors.join('; ')}`);
        }

        if (
            journey.dataset.failureMode === 'interruption' &&
            !journey.recoveryAttempts.some(attempt => attempt.includes('resumed successfully'))
        ) {
            issues.push(`Journey ${journey.journeyId}: interruption recovery was not confirmed.`);
        }

        if (
            journey.dataset.failureMode === 'recoverable' &&
            !journey.recoveryAttempts.some(attempt => attempt.startsWith('Recovered after'))
        ) {
            issues.push(`Journey ${journey.journeyId}: recoverable failure was not exercised.`);
        }
    }

    return issues;
}

async function cleanupJourneys(journeys: JourneyRecord[]): Promise<void> {
    for (const journey of journeys) {
        if (!journey.service || !journey.cleanup) {
            journey.cleanupStatus = 'not-required';
            continue;
        }

        try {
            await reconcileTrackedLeads(journey.service, journey.cleanup);
            const errors = await journey.cleanup.cleanup();
            journey.cleanupStatus = errors.length === 0 ? 'clean' : 'completed-with-errors';
            journey.cleanupErrors = errors;
        } catch (error) {
            journey.cleanupStatus = 'failed';
            journey.cleanupErrors = [error instanceof Error ? error.message : String(error)];
        }
    }
}

async function closeJourneyContexts(journeys: JourneyRecord[]): Promise<void> {
    for (const journey of journeys) {
        await journey.context?.close().catch(() => undefined);
    }
}
