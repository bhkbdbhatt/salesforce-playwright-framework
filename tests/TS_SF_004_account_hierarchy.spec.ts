import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../services/salesforceServiceFactory';
import { TestDataGenerator } from '../utils/testDataGenerator';
import { CleanupManager } from '../utils/cleanupManager';
import { captureFailure } from '../utils/diagnostics';

interface ChildNode {
    childAccountId: string;
    childAccountName: string;
    contacts: string[];
    opportunities: string[];
}

test('TS_SF_004: Multi-Level Account Hierarchy and Related Records', async ({ page }, testInfo) => {
    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const executionId = `HIER_${Date.now()}`;

    // 6. Maintain the complete hierarchy using nested collections.
    const hierarchy: { parentAccountId: string; parentAccountName: string; childAccounts: ChildNode[] } = {
        parentAccountId: '',
        parentAccountName: '',
        childAccounts: []
    };

    const updatedPhone = '9998887776';
    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;

    try {
        // 2. Create the Parent Account through the API.
        failedStep = 'Create Parent Account';
        const parentPayload = TestDataGenerator.generateAccountData();
        parentPayload.Name = `Parent_Acc_${executionId}`;
        hierarchy.parentAccountId = await sfApi.createAccount(parentPayload);
        hierarchy.parentAccountName = parentPayload.Name;
        cleanup.track('Account', hierarchy.parentAccountId);

        // 3, 4 & 5. Create Child Accounts with Contacts and Opportunities.
        for (let i = 1; i <= 2; i++) {
            failedStep = `Create Child Account ${i}`;
            const childPayload = TestDataGenerator.generateAccountData();
            childPayload.Name = `Child_Acc_${i}_${executionId}`;
            childPayload.ParentId = hierarchy.parentAccountId;

            const childAccountId = await sfApi.createAccount(childPayload);
            cleanup.track('Account', childAccountId);

            const child: ChildNode = {
                childAccountId,
                childAccountName: childPayload.Name,
                contacts: [],
                opportunities: []
            };

            for (let c = 1; c <= 2; c++) {
                failedStep = `Create Contact ${c} for Child Account ${i}`;
                const contactPayload = TestDataGenerator.generateContactData(childAccountId);
                contactPayload.LastName = `Child_${i}_Contact_${c}_${executionId}`;
                const contactId = await sfApi.createContact(contactPayload);
                child.contacts.push(contactId);
                cleanup.track('Contact', contactId);
            }

            for (let o = 1; o <= 2; o++) {
                failedStep = `Create Opportunity ${o} for Child Account ${i}`;
                const oppPayload = TestDataGenerator.generateOpportunityData(childAccountId, 30 + o * 10);
                oppPayload.Name = `Child_${i}_Opp_${o}_${executionId}`;
                const oppId = await sfApi.createOpportunity(oppPayload);
                child.opportunities.push(oppId);
                cleanup.track('Opportunity', oppId);
            }

            hierarchy.childAccounts.push(child);
        }

        // 7 & 8. Read the hierarchy and modify a selected child record through the API.
        failedStep = 'Modify selected child Account through API';
        await sfApi.updateAccount(hierarchy.childAccounts[0].childAccountId, { Phone: updatedPhone });

        // 9. Execute relationship-based SOQL.
        failedStep = 'SOQL hierarchy validation';
        const parent = await sfApi.getAccountHierarchy(hierarchy.parentAccountId);

        // 10. Validate Parent -> Child Account relationships.
        failedStep = 'Validate Parent -> Child relationships';
        expect(parent.Id).toBe(hierarchy.parentAccountId);
        expected = hierarchy.childAccounts.map(child => child.childAccountId).sort();
        actual = parent.ChildAccounts.records.map((child: any) => child.Id).sort();
        expect(actual).toEqual(expected);
        expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

        // 11, 12 & 13. Validate Child -> Contact/Opportunity relationships against
        // the nested runtime collection.
        failedStep = 'Validate Child -> Contact/Opportunity relationships';
        for (const child of hierarchy.childAccounts) {
            const childRecord = await sfApi.queryOne<any>(
                `SELECT Id, Phone, ParentId, (SELECT Id FROM Contacts), (SELECT Id FROM Opportunities) FROM Account WHERE Id = '${child.childAccountId}'`
            );

            expected = [...child.contacts].sort();
            actual = childRecord.Contacts.records.map((contact: any) => contact.Id).sort();
            expect(actual).toEqual(expected);
            expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

            expected = [...child.opportunities].sort();
            actual = childRecord.Opportunities.records.map((opp: any) => opp.Id).sort();
            expect(actual).toEqual(expected);
            expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

            expected = hierarchy.parentAccountId;
            actual = childRecord.ParentId;
            expect(actual).toBe(expected);
        }

        // Confirm the child Account API modification persisted in the backend.
        failedStep = 'Validate child Account API update through REST API';
        const updatedChild = await sfApi.getRecord<any>(
            'Account',
            hierarchy.childAccounts[0].childAccountId,
            ['Id', 'Name', 'Phone', 'ParentId']
        );
        expect(updatedChild.Phone).toBe(updatedPhone);
        expect(updatedChild.ParentId).toBe(hierarchy.parentAccountId);

        const parentRecord = await sfApi.getRecord<any>('Account', hierarchy.parentAccountId, [
            'Id',
            'Name'
        ]);
        expect(parentRecord.Name).toBe(hierarchy.parentAccountName);
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_004',
                failedStep,
                recordId:
                    hierarchy.childAccounts[0]?.childAccountId ?? hierarchy.parentAccountId,
                inputDataset: hierarchy,
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // 14. Clean up in reverse dependency order (Opportunities/Contacts before Accounts).
        await cleanup.cleanup();
    }
});
