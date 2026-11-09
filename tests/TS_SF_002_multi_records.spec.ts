import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../services/salesforceServiceFactory';
import { TestDataGenerator } from '../utils/testDataGenerator';
import { CleanupManager } from '../utils/cleanupManager';
import { captureFailure } from '../utils/diagnostics';

test('TS_SF_002: Multiple Contacts and Opportunities with Dynamic Data', async ({ page }, testInfo) => {
    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);

    const executionId = `MULTI_${Date.now()}`;
    const runtime = {
        accountId: '',
        contacts: [] as { id: string; payload: Record<string, any> }[],
        opportunities: [] as { id: string; payload: Record<string, any> }[]
    };

    const stages = ['Prospecting', 'Qualification', 'Needs Analysis'];
    const updatedContactTitle = `Senior Tester ${executionId}`;
    const updatedOppStage = 'Negotiation/Review';
    const updatedOppAmount = 99999;

    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;

    try {
        // 2 & 3. Generate unique Account data and create the Account through the API.
        failedStep = 'Create Account';
        const accountPayload = TestDataGenerator.generateAccountData();
        accountPayload.Name = `MultiAcc_${executionId}`;
        runtime.accountId = await sfApi.createAccount(accountPayload);
        cleanup.track('Account', runtime.accountId);

        // 4 & 7. Generate and create at least 3 Contacts associated with the Account.
        for (let i = 0; i < 3; i++) {
            failedStep = `Create Contact ${i + 1}`;
            const contactPayload = TestDataGenerator.generateContactData(runtime.accountId);
            contactPayload.FirstName = `Test${i + 1}`;
            contactPayload.LastName = `User_${executionId}_${i + 1}`;
            contactPayload.Email = `test${i + 1}.${executionId.toLowerCase()}@test.com`;

            const contactId = await sfApi.createContact(contactPayload);
            runtime.contacts.push({ id: contactId, payload: contactPayload });
            cleanup.track('Contact', contactId);
        }

        // 5 & 7. Generate and create at least 3 Opportunities with distinct values.
        for (let i = 0; i < 3; i++) {
            failedStep = `Create Opportunity ${i + 1}`;
            const oppPayload = TestDataGenerator.generateOpportunityData(runtime.accountId, 30 + i * 15);
            oppPayload.Name = `MultiOpp_${i + 1}_${executionId}`;
            oppPayload.StageName = stages[i];
            oppPayload.Amount = 25000 * (i + 1);

            const oppId = await sfApi.createOpportunity(oppPayload);
            runtime.opportunities.push({ id: oppId, payload: oppPayload });
            cleanup.track('Opportunity', oppId);
        }

        // 8. Update a selected Contact and Opportunity through the Salesforce API.
        failedStep = 'Update Contact via API';
        await sfApi.updateContact(runtime.contacts[0].id, { Title: updatedContactTitle });

        failedStep = 'Update Opportunity via API';
        await sfApi.updateOpportunity(runtime.opportunities[0].id, {
            StageName: updatedOppStage,
            Amount: updatedOppAmount,
            CloseDate: runtime.opportunities[0].payload.CloseDate
        });

        // 9. Retrieve all related records through SOQL.
        failedStep = 'SOQL relationship validation';
        const account = await sfApi.getFullSalesLifecycle(runtime.accountId);

        // 10, 11 & 12. Match SOQL results against the runtime collection and detect
        // missing, duplicate or incorrectly related records.
        failedStep = 'Validate collection against SOQL';
        expected = runtime.contacts.map(contact => contact.id).sort();
        actual = account.Contacts.records.map((contact: any) => contact.Id).sort();
        expect(account.Id).toBe(runtime.accountId);
        expect(actual).toEqual(expected);
        expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

        expected = runtime.opportunities.map(opp => opp.id).sort();
        actual = account.Opportunities.records.map((opp: any) => opp.Id).sort();
        expect(actual).toEqual(expected);
        expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

        // 11. Validate the API updates through SOQL.
        failedStep = 'Validate API updates through SOQL';
        const updatedContact = account.Contacts.records.find(
            (contact: any) => contact.Id === runtime.contacts[0].id
        );
        const updatedOpportunity = account.Opportunities.records.find(
            (opp: any) => opp.Id === runtime.opportunities[0].id
        );

        expected = updatedContactTitle;
        actual = updatedContact?.Title;
        expect(actual).toBe(expected);

        expected = { StageName: updatedOppStage, Amount: updatedOppAmount };
        actual = {
            StageName: updatedOpportunity?.StageName,
            Amount: updatedOpportunity?.Amount
        };
        expect(actual).toEqual(expected);

        // 11. Validate the same updated values independently through the REST API.
        failedStep = 'Validate updated records through REST API';
        const contactRecord = await sfApi.getRecord<any>('Contact', runtime.contacts[0].id, [
            'Id',
            'Title',
            'AccountId'
        ]);
        const opportunityRecord = await sfApi.getRecord<any>('Opportunity', runtime.opportunities[0].id, [
            'Id',
            'StageName',
            'Amount',
            'AccountId'
        ]);
        const accountRecord = await sfApi.getRecord<any>('Account', runtime.accountId, ['Id', 'Name']);

        expect(contactRecord.Title).toBe(updatedContactTitle);
        expect(contactRecord.AccountId).toBe(runtime.accountId);
        expect(opportunityRecord.StageName).toBe(updatedOppStage);
        expect(opportunityRecord.Amount).toBe(updatedOppAmount);
        expect(opportunityRecord.AccountId).toBe(runtime.accountId);
        expect(accountRecord.Name).toBe(`MultiAcc_${executionId}`);
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_002',
                failedStep,
                recordId:
                    runtime.opportunities[0]?.id ??
                    runtime.contacts[0]?.id ??
                    runtime.accountId,
                inputDataset: runtime,
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // 13. Clean up all dynamically created records in reverse dependency order.
        await cleanup.cleanup();
    }
});
