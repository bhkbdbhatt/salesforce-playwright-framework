/**
 * ============================================================================
 * WEEK 2 — SCENARIO 1
 * "Multiple Account Hierarchies and Related Records"
 * Source: Week2.pdf (Scenario 1)
 * ----------------------------------------------------------------------------
 * Goal: create two Parent Accounts, two Child Accounts per parent, and three
 * Contacts plus two Opportunities per Child Account. Validate the complete tree
 * through the Lightning UI and SOQL, then update two Contacts and two
 * Opportunities and confirm the runtime collection matches the backend.
 *
 * Execution engine: all writes go through `SalesforceOperations`, created by
 * the factory. The default is API mode; set EXECUTION_MODE='ui' in
 * config/execution.config.ts (or SF_EXECUTION_MODE=ui) to drive Lightning.
 * SOQL/REST reads always use the API because they are the verification layer.
 *
 * PDF expected-automation step -> implementation:
 *   1. Login to Salesforce ................. tests/auth.setup.ts (storageState)
 *   2. Unique execution ID ................. createExecutionId('W2S1') + regex
 *   3. >= 2 Parent Accounts ................ parents loop (p = 1..2)
 *   4. >= 2 Child Accounts per Parent ...... children loop (c = 1..2)
 *   5. >= 3 Contacts + 2 Opportunities ..... inner loops per Child Account
 *   6. Create with Playwright API .......... sfApi.createAccount/Contact/Opportunity
 *   7. Nested Map/Collection ............... `parents` tree + child arrays
 *   8. Regex validation .................... executionId/account/email/record ID
 *   9. Navigate hierarchy through UI ....... assertRecordPageShows(parent/child)
 *  10. Update 2 Contacts + 2 Opportunities . sfApi.updateContact/updateOpportunity
 *  11. Update runtime collection ........... node.expectedTitle/expectedStage...
 *  12. Execute SOQL ........................ parent hierarchy + child subqueries
 *  13. Validate associations + updates ..... ID equality, ParentId, SOQL values
 *  14. Detect missing/duplicate/mislinked .. collectCollectionIssues -> report
 *  15. Cleanup dependency order ............ utils/cleanupManager.ts (finally)
 *  16. Diagnostics + five clean runs ....... captureFailure + npm run test:repeat
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../../services/salesforceServiceFactory';
import { TestDataGenerator } from '../../utils/testDataGenerator';
import { CleanupManager } from '../../utils/cleanupManager';
import { captureFailure } from '../../utils/diagnostics';
import {
    assertRecordPageShows,
    collectCollectionIssues,
    createExecutionId,
    expectMatches,
    expectSalesforceId,
    futureDateIso
} from './support/week2Helpers';

const EXECUTION_ID_PATTERN = /^W2S1_\d{13}_[A-Z0-9]{4}$/;
const PARENT_NAME_PATTERN = /^W2S1_Parent_\d+_W2S1_\d{13}_[A-Z0-9]{4}$/;
const CHILD_NAME_PATTERN = /^W2S1_Child_\d+_\d+_W2S1_\d{13}_[A-Z0-9]{4}$/;
const CONTACT_EMAIL_PATTERN = /^w2s1\.contact\.\d+\.\d+\.\d+\.\d+@example\.test$/;

interface ContactNode {
    id: string;
    email: string;
    expectedTitle?: string;
}

interface OpportunityNode {
    id: string;
    name: string;
    stage: string;
    amount: number;
    closeDate: string;
    expectedStage: string;
    expectedAmount: number;
    expectedCloseDate: string;
}

interface ChildNode {
    id: string;
    name: string;
    contacts: ContactNode[];
    opportunities: OpportunityNode[];
}

interface ParentNode {
    id: string;
    name: string;
    children: ChildNode[];
}

test('TS_SF_W2_001: Multiple Account Hierarchies and Related Records', async ({ page }, testInfo) => {
    test.setTimeout(900000);

    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const executionId = createExecutionId('W2S1');

    expectMatches('Execution ID', executionId, EXECUTION_ID_PATTERN);

    const parents: ParentNode[] = [];
    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let lastRecordId: string | undefined;

    try {
        // PDF steps 2, 3, 4, 5, 6 & 7 — Generate and create the complete
        // hierarchy, storing every ID in a nested collection.
        for (let p = 1; p <= 2; p++) {
            failedStep = `Create Parent Account ${p}`;
            const parentPayload = TestDataGenerator.generateAccountData();
            const parentName = `W2S1_Parent_${p}_${executionId}`;
            parentPayload.Name = parentName;
            parentPayload.Industry = 'Technology';
            parentPayload.Type = 'Prospect';

            expectMatches(`Parent Account ${p} name`, parentName, PARENT_NAME_PATTERN);
            const parentId = await sfApi.createAccount(parentPayload);
            expectSalesforceId(`Parent Account ${p} ID`, parentId);
            cleanup.track('Account', parentId);
            lastRecordId = parentId;

            const parentNode: ParentNode = { id: parentId, name: parentName, children: [] };

            for (let c = 1; c <= 2; c++) {
                failedStep = `Create Child Account ${c} for Parent ${p}`;
                const childPayload = TestDataGenerator.generateAccountData();
                const childName = `W2S1_Child_${p}_${c}_${executionId}`;
                childPayload.Name = childName;
                childPayload.ParentId = parentId;
                childPayload.Industry = 'Technology';

                expectMatches(`Child Account ${p}.${c} name`, childName, CHILD_NAME_PATTERN);
                const childId = await sfApi.createAccount(childPayload);
                expectSalesforceId(`Child Account ${p}.${c} ID`, childId);
                cleanup.track('Account', childId);
                lastRecordId = childId;

                const childNode: ChildNode = {
                    id: childId,
                    name: childName,
                    contacts: [],
                    opportunities: []
                };

                // PDF step 5 — at least three Contacts per Child Account.
                for (let k = 1; k <= 3; k++) {
                    failedStep = `Create Contact ${k} for Child ${p}.${c}`;
                    const contactPayload = TestDataGenerator.generateContactData(childId);
                    const email = `w2s1.contact.${p}.${c}.${k}.${Date.now()}@example.test`;
                    contactPayload.FirstName = `W2S1_${p}_${c}_${k}`;
                    contactPayload.LastName = `Contact_${p}_${c}_${k}_${executionId}`;
                    contactPayload.Email = email;

                    expectMatches(`Contact ${p}.${c}.${k} email`, email, CONTACT_EMAIL_PATTERN);
                    const contactId = await sfApi.createContact(contactPayload);
                    expectSalesforceId(`Contact ${p}.${c}.${k} ID`, contactId);
                    cleanup.track('Contact', contactId);
                    lastRecordId = contactId;
                    childNode.contacts.push({ id: contactId, email });
                }

                // PDF step 5 — at least two Opportunities per Child Account.
                for (let o = 1; o <= 2; o++) {
                    failedStep = `Create Opportunity ${o} for Child ${p}.${c}`;
                    const closeDate = futureDateIso(30 + o * 15);
                    const amount = p * 10000 + c * 5000 + o * 1000;
                    const oppPayload = TestDataGenerator.generateOpportunityData(
                        childId,
                        30 + o * 15
                    );
                    oppPayload.Name = `W2S1_Opp_${p}_${c}_${o}_${executionId}`;
                    oppPayload.StageName = o === 1 ? 'Prospecting' : 'Qualification';
                    oppPayload.Amount = amount;
                    oppPayload.CloseDate = closeDate;

                    const oppId = await sfApi.createOpportunity(oppPayload);
                    expectSalesforceId(`Opportunity ${p}.${c}.${o} ID`, oppId);
                    cleanup.track('Opportunity', oppId);
                    lastRecordId = oppId;

                    childNode.opportunities.push({
                        id: oppId,
                        name: oppPayload.Name,
                        stage: oppPayload.StageName,
                        amount,
                        closeDate,
                        expectedStage: oppPayload.StageName,
                        expectedAmount: amount,
                        expectedCloseDate: closeDate
                    });
                }

                parentNode.children.push(childNode);
            }

            parents.push(parentNode);
        }

        // PDF steps 9 & 10 — Navigate the hierarchy through the Lightning UI
        // and update the first two Contacts plus the first two Opportunities.
        failedStep = 'Navigate the Account hierarchy through the UI';
        for (const parent of parents) {
            await assertRecordPageShows(page, 'Account', parent.id, [parent.name]);
            for (const child of parent.children) {
                await assertRecordPageShows(page, 'Account', child.id, [child.name]);
            }
        }

        const allContacts = parents.flatMap(parent =>
            parent.children.flatMap(child => child.contacts)
        );
        const allOpportunities = parents.flatMap(parent =>
            parent.children.flatMap(child => child.opportunities)
        );

        for (let i = 0; i < 2; i++) {
            const contact = allContacts[i];
            failedStep = `Update Contact ${i + 1}`;
            const updatedTitle = `W2S1 Updated Title ${i + 1} ${executionId}`;
            await sfApi.updateContact(contact.id, { Title: updatedTitle });
            contact.expectedTitle = updatedTitle;

            const opportunity = allOpportunities[i];
            failedStep = `Update Opportunity ${i + 1}`;
            const updatedStage = i === 0 ? 'Needs Analysis' : 'Value Proposition';
            const updatedAmount = opportunity.amount + 2500 * (i + 1);
            const updatedCloseDate = futureDateIso(75 + i * 10);

            await sfApi.updateOpportunity(opportunity.id, {
                StageName: updatedStage,
                Amount: updatedAmount,
                CloseDate: updatedCloseDate
            });

            opportunity.expectedStage = updatedStage;
            opportunity.expectedAmount = updatedAmount;
            opportunity.expectedCloseDate = updatedCloseDate;
        }

        // PDF steps 12, 13 & 14 — Execute SOQL for Parent Accounts, Child
        // Accounts, Contacts and Opportunities; compare each result with the
        // runtime collection and collect every missing/duplicate/mislinked item.
        failedStep = 'SOQL hierarchy and related-record validation';
        const issues: string[] = [];

        for (const parent of parents) {
            const parentRecord = await sfApi.queryOne<any>(
                `SELECT Id, Name, (SELECT Id, Name, ParentId FROM ChildAccounts) FROM Account WHERE Id = '${parent.id}'`
            );

            expect(parentRecord.Id).toBe(parent.id);
            expect(parentRecord.Name).toBe(parent.name);

            issues.push(
                ...collectCollectionIssues(
                    `Parent ${parent.name} children`,
                    parent.children.map(child => child.id),
                    parentRecord.ChildAccounts.records.map((child: any) => child.Id)
                )
            );

            for (const child of parent.children) {
                const childRecord = await sfApi.queryOne<any>(
                    `SELECT Id, Name, ParentId, ` +
                        `(SELECT Id, FirstName, LastName, Email, Title FROM Contacts), ` +
                        `(SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunities) ` +
                        `FROM Account WHERE Id = '${child.id}'`
                );

                expect(childRecord.Name).toBe(child.name);
                if (childRecord.ParentId !== parent.id) {
                    issues.push(
                        `Child ${child.name} (${child.id}) is linked to ParentId ${childRecord.ParentId}, expected ${parent.id}`
                    );
                }

                issues.push(
                    ...collectCollectionIssues(
                        `Child ${child.name} contacts`,
                        child.contacts.map(contact => contact.id),
                        childRecord.Contacts.records.map((contact: any) => contact.Id)
                    )
                );
                issues.push(
                    ...collectCollectionIssues(
                        `Child ${child.name} opportunities`,
                        child.opportunities.map(opportunity => opportunity.id),
                        childRecord.Opportunities.records.map((opportunity: any) => opportunity.Id)
                    )
                );

                for (const contact of child.contacts) {
                    const dbContact = childRecord.Contacts.records.find(
                        (record: any) => record.Id === contact.id
                    );

                    if (!dbContact) {
                        issues.push(`Contact ${contact.id} is missing from Child ${child.name}`);
                        continue;
                    }

                    expectMatches(`Contact ${contact.id} email`, dbContact.Email, CONTACT_EMAIL_PATTERN);
                    if (contact.expectedTitle) {
                        expect(dbContact.Title).toBe(contact.expectedTitle);
                    }
                }

                for (const opportunity of child.opportunities) {
                    const dbOpportunity = childRecord.Opportunities.records.find(
                        (record: any) => record.Id === opportunity.id
                    );

                    if (!dbOpportunity) {
                        issues.push(
                            `Opportunity ${opportunity.id} is missing from Child ${child.name}`
                        );
                        continue;
                    }

                    expect(dbOpportunity.StageName).toBe(opportunity.expectedStage);
                    expect(dbOpportunity.Amount).toBeCloseTo(opportunity.expectedAmount, 2);
                    expect(dbOpportunity.CloseDate).toBe(opportunity.expectedCloseDate);
                }
            }
        }

        expected = 'no missing, duplicate or incorrectly associated records';
        actual = issues;

        if (issues.length > 0) {
            throw new Error(`Account hierarchy validation failed:\n${issues.join('\n')}`);
        }
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_W2_001',
                failedStep,
                recordId: lastRecordId,
                inputDataset: parents,
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // PDF step 15 — Opportunities and Contacts are deleted before their
        // Child Accounts, and Child Accounts before the Parent Accounts.
        await cleanup.cleanup();
    }
});
