/**
 * ============================================================================
 * PDF SCENARIO 1 — "Account, Contact and Opportunity Lifecycle"
 * Source: "Week 1 Sceanrios 1.pdf" (Scenario 1)
 * ----------------------------------------------------------------------------
 * Goal: automate an end-to-end sales flow that creates and validates an
 * Account, a Contact and an Opportunity.
 *
 * Execution engine: every write uses `SalesforceOperations` created by the
 * factory. The default is API mode; set EXECUTION_MODE='ui' in
 * config/execution.config.ts to run the same steps through the Lightning UI.
 * SOQL / REST reads always go through the API.
 *
 * PDF expected-automation step -> code that implements it (demo map):
 *   1. Login to Salesforce ................ tests/auth.setup.ts (storageState)
 *   2. Unique Account + Contact data ...... utils/testDataGenerator.ts + executionId
 *   3. Create Account via Playwright API .. sfApi.createAccount -> api/sfApiClient.ts
 *   4. Store Account ID/runtime values .... runtimeMap (Map)
 *   5. Create Contact for the Account ..... sfApi.createContact
 *   6. Create Opportunity for Account ..... sfApi.createOpportunity
 *   7. Update Stage, Amount, Close Date ... sfApi.updateOpportunity
 *   8. Store generated record IDs ......... runtimeMap + cleanup.track
 *   9. Execute SOQL ....................... sfApi.getFullSalesLifecycle
 *  10. Validate Account -> Contact -> Opp . expect() relationship checks
 *  11. Validate via UI + SOQL/API ......... SOQL + REST GET cross-check
 *  12. Clean up via Playwright API ........ utils/cleanupManager.ts (finally)
 *  13. Failure diagnostics ................ utils/diagnostics.ts captureFailure
 *  14. 5 consecutive executions ........... npm run test:repeat (--repeat-each=5)
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../services/salesforceServiceFactory';
import { TestDataGenerator } from '../utils/testDataGenerator';
import { CleanupManager } from '../utils/cleanupManager';
import { captureFailure } from '../utils/diagnostics';

test('TS_SF_001: Account, Contact and Opportunity Lifecycle', async ({ page }, testInfo) => {
    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const runtimeMap = new Map<string, any>();

    const executionId = `TEST_${Date.now()}`;
    const accountPayload = TestDataGenerator.generateAccountData();
    accountPayload.Name = `${accountPayload.Name}_${executionId}`;

    const oppName = `Opp_${executionId}`;
    const initialAmount = 50000;
    const updatedStage = 'Negotiation/Review';
    const updatedAmount = 75000;
    const closeDate = (() => {
        const date = new Date();
        date.setDate(date.getDate() + 30);
        return date.toISOString().split('T')[0];
    })();

    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let accountId: string | undefined;
    let contactId: string | undefined;

    try {
        // PDF step 1 — Login.
        // The setup project authenticates once and saves .auth/user.json, which the
        // e2e project reuses via storageState, so no login code is needed here.

        // PDF steps 2 & 3 — Generate unique Account data, then create the Account
        // through Playwright. In 'api' mode this is REST; in 'ui' mode the same
        // call drives the Lightning "New Account" page.
        failedStep = 'Create Account via API';
        accountId = await sfApi.createAccount(accountPayload);

        // PDF step 4 — Store the generated Account ID and runtime values in a Map.
        runtimeMap.set('accountId', accountId);
        cleanup.track('Account', accountId);

        // PDF steps 2 & 5 — Generate unique Contact data linked to the Account and
        // create it through Playwright (API in 'api' mode, Lightning UI in 'ui' mode).
        failedStep = 'Create Contact via API';
        const contactPayload = TestDataGenerator.generateContactData(accountId);
        contactId = await sfApi.createContact(contactPayload);
        runtimeMap.set('contactId', contactId);
        cleanup.track('Contact', contactId);

        // PDF steps 6 & 8 — Create an Opportunity for the Account (Lightning UI in
        // 'ui' mode, REST in 'api' mode) and keep its ID in the runtime Map.
        failedStep = 'Create Opportunity via API';
        const opportunityPayload = {
            Name: oppName,
            StageName: 'Prospecting',
            Amount: initialAmount,
            CloseDate: closeDate,
            AccountId: accountId
        };
        const opportunityId = await sfApi.createOpportunity(opportunityPayload);
        runtimeMap.set('opportunityId', opportunityId);
        cleanup.track('Opportunity', opportunityId);

        // PDF steps 7 & 8 — Update Opportunity Stage, Amount and Close Date and
        // record the new values in the runtime Map for later comparison.
        failedStep = 'Update Opportunity via API';
        await sfApi.updateOpportunity(opportunityId, {
            StageName: updatedStage,
            Amount: updatedAmount,
            CloseDate: closeDate
        });
        runtimeMap.set('opportunityStage', updatedStage);
        runtimeMap.set('opportunityAmount', updatedAmount);
        runtimeMap.set('opportunityCloseDate', closeDate);

        // PDF step 9 — Execute SOQL through Playwright to retrieve the Account,
        // Contact and Opportunity together (query builder: api/soqlQueries.ts).
        failedStep = 'SOQL relationship validation';
        const account = await sfApi.getFullSalesLifecycle(accountId);

        // PDF step 10 — Validate the Account -> Contact -> Opportunity relationships.
        failedStep = 'Validate Account -> Contact -> Opportunity relationships';
        expected = contactId;
        actual = account.Contacts.records[0]?.Id;
        expect(account.Id).toBe(accountId);
        expect(actual).toBe(expected);
        expect(account.Opportunities.records.length).toBe(1);
        expect(account.Opportunities.records[0].Id).toBe(opportunityId);

        // PDF step 11 — Validate the updated business values through SOQL.
        failedStep = 'Validate updated Opportunity values through SOQL';
        expected = {
            StageName: updatedStage,
            Amount: updatedAmount,
            CloseDate: closeDate
        };
        actual = {
            StageName: account.Opportunities.records[0].StageName,
            Amount: account.Opportunities.records[0].Amount,
            CloseDate: account.Opportunities.records[0].CloseDate
        };
        expect(actual).toEqual(expected);

        // PDF step 11 — Cross-check the same business data through a second path,
        // the REST GET API, so UI/SOQL results are independently confirmed.
        failedStep = 'Validate records through REST API';
        const accountRecord = await sfApi.getRecord<any>('Account', accountId, ['Id', 'Name']);
        const opportunityRecord = await sfApi.getRecord<any>('Opportunity', opportunityId, [
            'Id',
            'Name',
            'StageName',
            'Amount',
            'CloseDate'
        ]);

        expect(accountRecord.Name).toBe(accountPayload.Name);
        expect(opportunityRecord.StageName).toBe(updatedStage);
        expect(opportunityRecord.Amount).toBe(updatedAmount);
        expect(opportunityRecord.CloseDate).toBe(closeDate);
    } catch (error) {
        // PDF step 13 — On failure capture the failing step, record ID,
        // expected/actual values, logs and a screenshot (utils/diagnostics.ts).
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_001',
                failedStep,
                recordId:
                    runtimeMap.get('opportunityId') ??
                    runtimeMap.get('contactId') ??
                    runtimeMap.get('accountId'),
                inputDataset: {
                    account: accountPayload,
                    opportunity: {
                        name: oppName,
                        stage: updatedStage,
                        amount: updatedAmount,
                        closeDate
                    }
                },
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // PDF step 12 — Clean up created records through Playwright in reverse
        // dependency order (Opportunity -> Contact -> Account).
        await cleanup.cleanup();
    }
});
