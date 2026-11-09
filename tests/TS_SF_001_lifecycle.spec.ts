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
        // 1. Login is handled by the setup project through storageState.

        // 2 & 3. Generate unique Account test data and create it through the Salesforce API.
        failedStep = 'Create Account via API';
        accountId = await sfApi.createAccount(accountPayload);
        runtimeMap.set('accountId', accountId);
        cleanup.track('Account', accountId);

        // 2 & 5. Generate unique Contact test data and create it through the Salesforce API.
        failedStep = 'Create Contact via API';
        const contactPayload = TestDataGenerator.generateContactData(accountId);
        contactId = await sfApi.createContact(contactPayload);
        runtimeMap.set('contactId', contactId);
        cleanup.track('Contact', contactId);

        // 6 & 8. Create an Opportunity for the Account through the Salesforce API.
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

        // 7 & 8. Update Opportunity Stage, Amount and Close Date through the API.
        failedStep = 'Update Opportunity via API';
        await sfApi.updateOpportunity(opportunityId, {
            StageName: updatedStage,
            Amount: updatedAmount,
            CloseDate: closeDate
        });
        runtimeMap.set('opportunityStage', updatedStage);
        runtimeMap.set('opportunityAmount', updatedAmount);
        runtimeMap.set('opportunityCloseDate', closeDate);

        // 9. Execute SOQL to retrieve Account, Contact and Opportunity data.
        failedStep = 'SOQL relationship validation';
        const account = await sfApi.getFullSalesLifecycle(accountId);

        // 10. Validate Account -> Contact -> Opportunity relationships.
        failedStep = 'Validate Account -> Contact -> Opportunity relationships';
        expected = contactId;
        actual = account.Contacts.records[0]?.Id;
        expect(account.Id).toBe(accountId);
        expect(actual).toBe(expected);
        expect(account.Opportunities.records.length).toBe(1);
        expect(account.Opportunities.records[0].Id).toBe(opportunityId);

        // 11. Validate updated business values through SOQL.
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

        // 11. Validate the same key business data independently through the REST API.
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
        // 12. Clean up created records in reverse dependency order.
        await cleanup.cleanup();
    }
});
