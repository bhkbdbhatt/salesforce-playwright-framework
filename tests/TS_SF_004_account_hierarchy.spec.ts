/**
 * ============================================================================
 * PDF SCENARIO 4 — "Multi-Level Account Hierarchy and Related Records"
 * Source: "Week 1 Sceanrios 1.pdf" (Scenario 4)
 * ----------------------------------------------------------------------------
 * Goal: automate a Parent Account with Child Accounts, each owning Contacts
 * and Opportunities, and validate the whole tree.
 *
 * Hierarchy built by this test:
 *   Parent Account
 *     +-- Child Account 1 -> 2 Contacts + 2 Opportunities
 *     +-- Child Account 2 -> 2 Contacts + 2 Opportunities
 *
 * Execution engine: writes go through `SalesforceOperations` (API by default,
 * Lightning UI when EXECUTION_MODE='ui'). SOQL / REST reads always use the API.
 *
 * PDF expected-automation step -> code that implements it (demo map):
 *   1. Login ............................. tests/auth.setup.ts
 *   2. Create Parent Account via API ..... sfApi.createAccount
 *   3. Create Child Accounts ............. loop i=1..2, ParentId set
 *   4. Contacts per Child Account ........ inner loop, generateContactData
 *   5. Opportunities per Child Account ... inner loop, generateOpportunityData
 *   6. Nested hierarchy collection ....... `hierarchy` (parent -> children[])
 *   7. Navigate hierarchy via UI ......... sfApi.updateAccount (UI in 'ui' mode)
 *   8. Modify selected child record ...... updateAccount(child[0], Phone)
 *   9. Relationship-based SOQL ........... sfApi.getAccountHierarchy
 *  10. Validate Parent -> Child .......... expect(child IDs) equality
 *  11. Validate Child -> Contact/Opp ..... per-child SOQL sub-queries
 *  12. Compare against nested collection . expected from `hierarchy`
 *  13. Detect incorrect/missing links .... Set-size + equality checks
 *  14. Cleanup in dependency order ....... utils/cleanupManager.ts (finally)
 *  15. Failure diagnostics ............... utils/diagnostics.ts captureFailure
 *  16. 5 consecutive stable executions ... npm run test:repeat (--repeat-each=5)
 * ============================================================================
 */
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

    // PDF step 6 — Maintain the complete hierarchy using a nested collection:
    // parent details plus a `childAccounts` array, each with its own contact
    // and opportunity ID arrays.
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
        // PDF step 2 — Dynamically create the Parent Account through Playwright
        // (REST in 'api' mode, Lightning UI in 'ui' mode).
        failedStep = 'Create Parent Account';
        const parentPayload = TestDataGenerator.generateAccountData();
        parentPayload.Name = `Parent_Acc_${executionId}`;
        hierarchy.parentAccountId = await sfApi.createAccount(parentPayload);
        hierarchy.parentAccountName = parentPayload.Name;
        cleanup.track('Account', hierarchy.parentAccountId);

        // PDF steps 3, 4 & 5 — Create two Child Accounts linked to the Parent,
        // then add 2 Contacts and 2 Opportunities to each Child Account.
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

        // PDF steps 7 & 8 — Navigate to a selected child record and modify it
        // (Lightning UI in 'ui' mode, REST in 'api' mode).
        failedStep = 'Modify selected child Account through API';
        await sfApi.updateAccount(hierarchy.childAccounts[0].childAccountId, { Phone: updatedPhone });

        // PDF step 9 — Execute relationship-based SOQL for the parent and its
        // child Accounts (query builder: SoqlQueries.getAccountHierarchy).
        failedStep = 'SOQL hierarchy validation';
        const parent = await sfApi.getAccountHierarchy(hierarchy.parentAccountId);

        // PDF step 10 — Validate Parent -> Child Account relationships.
        failedStep = 'Validate Parent -> Child relationships';
        expect(parent.Id).toBe(hierarchy.parentAccountId);
        expected = hierarchy.childAccounts.map(child => child.childAccountId).sort();
        actual = parent.ChildAccounts.records.map((child: any) => child.Id).sort();
        expect(actual).toEqual(expected);
        expect(new Set(actual as string[]).size).toBe((actual as string[]).length);

        // PDF steps 11, 12 & 13 — Validate Child -> Contact/Opportunity
        // relationships against the nested runtime collection and detect
        // incorrect, missing or unexpectedly associated records (Set-size check).
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

        // PDF step 12 — Confirm the child Account modification persisted by
        // reading it back through a second path (REST GET).
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
        // PDF step 15 — Provide diagnostic information (failed step, record ID,
        // dataset, expected/actual values, screenshot) for any failure.
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
        // PDF step 14 — Clean up in the correct dependency order: Opportunities
        // and Contacts before Accounts (children before the Parent).
        await cleanup.cleanup();
    }
});
