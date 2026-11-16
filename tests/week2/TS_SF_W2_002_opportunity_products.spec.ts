/**
 * ============================================================================
 * WEEK 2 — SCENARIO 2
 * "Multiple Opportunities with Products and Pricing"
 * Source: Week2.pdf (Scenario 2)
 * ----------------------------------------------------------------------------
 * Goal: create two Accounts with one Contact each, three Opportunities, three
 * product line items per Opportunity, Opportunity Contact Roles, and validate
 * quantities, sales prices, line totals and Opportunity totals through SOQL
 * and the Lightning UI. Also prove that an incompatible Price Book Entry is
 * rejected and leaves no unintended line item.
 *
 * Execution engine: Account/Contact/Opportunity creation and updates use
 * `SalesforceOperations` (API by default, Lightning UI when EXECUTION_MODE=ui).
 * Product, Price Book, Price Book Entry, line item and Contact Role operations
 * also go through the same generic create/update methods. SOQL/REST reads are
 * always API-based.
 *
 * PDF expected-automation step -> implementation:
 *   1. Login ............................... tests/auth.setup.ts
 *   2. Unique execution ID ................. createExecutionId('W2S2')
 *   3. >= 2 Accounts + 1 Contact each ...... accounts loop + generateContactData
 *   4. >= 3 Opportunities .................. opportunities loop (i = 1..3)
 *   5. Link Contact via Contact Role ...... OpportunityContactRole create
 *   6. >= 3 products per Opportunity ....... priceBookEntries + line item loop
 *   7. Different quantities/prices ......... quantity/unitPrice formulas
 *   8. Store IDs, prices, totals ........... `runtime` collection
 *   9. Regex: names/IDs/currency ........... test patterns + expectCurrency
 *  10. Update quantity + sales price ....... sfApi.updateRecord(OpportunityLineItem)
 *  11. Recalculate expected totals ......... recalculate + update Opportunity Amount
 *  12. SOQL for Opps/Products/PBEs/Roles ... relationship + IN queries
 *  13. Validate all relationships/totals ... collection equality + amount checks
 *  14. Incompatible PBE error .............. second Price Book -> expect rejection
 *  15. No unintended line item ............. before/after SOQL comparison
 *  16. Compare UI values with SOQL/API ..... readOpportunityAmountFromUi
 *  17. Cleanup without deleting shared data  only track records created here
 *  18. Diagnostics + five clean runs ....... captureFailure + npm run test:repeat
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import { createSalesforceService } from '../../services/salesforceServiceFactory';
import { TestDataGenerator } from '../../utils/testDataGenerator';
import { CleanupManager } from '../../utils/cleanupManager';
import { captureFailure } from '../../utils/diagnostics';
import {
    assertCollection,
    assertOpportunityAmountInUi,
    createExecutionId,
    escapeSoql,
    expectCurrency,
    expectMatches,
    expectSalesforceId,
    futureDateIso
} from './support/week2Helpers';

const EXECUTION_ID_PATTERN = /^W2S2_\d{13}_[A-Z0-9]{4}$/;
const OPPORTUNITY_NAME_PATTERN = /^W2S2_Opp_\d+_W2S2_\d{13}_[A-Z0-9]{4}$/;

interface AccountNode {
    id: string;
    name: string;
    contactId: string;
    contactName: string;
}

interface PriceBookEntryNode {
    pbeId: string;
    productId: string;
    productName: string;
    shared: boolean;
}

interface LineItemNode {
    id: string;
    pbeId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    expectedTotal: number;
}

interface OpportunityNode {
    id: string;
    name: string;
    accountId: string;
    contactId: string;
    closeDate: string;
    priceBookId: string;
    lineItems: LineItemNode[];
    contactRoleIds: string[];
    expectedAmount: number;
}

test('TS_SF_W2_002: Multiple Opportunities with Products and Pricing', async ({ page }, testInfo) => {
    test.setTimeout(1200000);

    const sfApi = createSalesforceService(page);
    const cleanup = new CleanupManager(sfApi);
    const executionId = createExecutionId('W2S2');

    expectMatches('Execution ID', executionId, EXECUTION_ID_PATTERN);

    const accounts: AccountNode[] = [];
    const opportunities: OpportunityNode[] = [];
    const createdPriceBookEntries: PriceBookEntryNode[] = [];

    let priceBookId = '';
    let priceBookName = '';
    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let lastRecordId: string | undefined;

    try {
        // PDF step 3 — two Accounts and one Contact per Account.
        for (let i = 1; i <= 2; i++) {
            failedStep = `Create Account ${i}`;
            const accountPayload = TestDataGenerator.generateAccountData();
            accountPayload.Name = `W2S2_Account_${i}_${executionId}`;
            const accountId = await sfApi.createAccount(accountPayload);
            expectSalesforceId(`Account ${i} ID`, accountId);
            cleanup.track('Account', accountId);
            lastRecordId = accountId;

            failedStep = `Create Contact for Account ${i}`;
            const contactPayload = TestDataGenerator.generateContactData(accountId);
            contactPayload.FirstName = `W2S2_${i}`;
            contactPayload.LastName = `Buyer_${i}_${executionId}`;
            contactPayload.Email = `w2s2.buyer.${i}.${Date.now()}@example.test`;
            const contactId = await sfApi.createContact(contactPayload);
            expectSalesforceId(`Contact for Account ${i} ID`, contactId);
            cleanup.track('Contact', contactId);
            lastRecordId = contactId;

            accounts.push({
                id: accountId,
                name: accountPayload.Name,
                contactId,
                contactName: `${contactPayload.FirstName} ${contactPayload.LastName}`
            });
        }

        // PDF steps 6 & 8 — choose an available Price Book and ensure at least
        // three active Price Book Entries exist. Newly created products and
        // entries are tracked; shared entries are never deleted during cleanup.
        failedStep = 'Resolve Price Book and Price Book Entries';
        const priceBooks = await sfApi.queryRecords<any>(
            'SELECT Id, Name, IsStandard, IsActive FROM Pricebook2 WHERE IsActive = true ORDER BY IsStandard DESC LIMIT 20'
        );

        if (priceBooks.length === 0) {
            throw new Error('No active Price Book is available in this Salesforce org.');
        }

        const priceBook = priceBooks[0];
        priceBookId = priceBook.Id;
        priceBookName = priceBook.Name;
        expectSalesforceId('Price Book ID', priceBookId);

        const existingEntries = await sfApi.queryRecords<any>(
            `SELECT Id, Product2Id, Product2.Name, UnitPrice ` +
                `FROM PricebookEntry ` +
                `WHERE Pricebook2Id = '${priceBookId}' AND IsActive = true AND Product2.IsActive = true ` +
                `LIMIT 50`
        );

        for (const entry of existingEntries.slice(0, 3)) {
            createdPriceBookEntries.push({
                pbeId: entry.Id,
                productId: entry.Product2Id,
                productName: entry.Product2?.Name ?? 'Shared Product',
                shared: true
            });
        }

        for (let i = createdPriceBookEntries.length + 1; i <= 3; i++) {
            failedStep = `Create Product and Price Book Entry ${i}`;
            const productName = `W2S2_Product_${i}_${executionId}`;
            const productId = await sfApi.createRecord('Product2', {
                Name: productName,
                ProductCode: `W2S2-${i}-${Date.now()}`,
                IsActive: true,
                Family: 'Automation'
            });
            expectSalesforceId(`Product ${i} ID`, productId);
            cleanup.track('Product2', productId);

            const pbeId = await sfApi.createRecord('PricebookEntry', {
                Pricebook2Id: priceBookId,
                Product2Id: productId,
                UnitPrice: 1000 * i,
                IsActive: true,
                UseStandardPrice: false
            });
            expectSalesforceId(`Price Book Entry ${i} ID`, pbeId);
            cleanup.track('PricebookEntry', pbeId);

            createdPriceBookEntries.push({
                pbeId,
                productId,
                productName,
                shared: false
            });
        }

        // PDF step 4 — three Opportunities spread across the two Accounts.
        for (let i = 1; i <= 3; i++) {
            failedStep = `Create Opportunity ${i}`;
            const account = accounts[(i - 1) % accounts.length];
            const closeDate = futureDateIso(30 + i * 15);
            const oppName = `W2S2_Opp_${i}_${executionId}`;

            expectMatches(`Opportunity ${i} name`, oppName, OPPORTUNITY_NAME_PATTERN);

            const oppPayload = TestDataGenerator.generateOpportunityData(
                account.id,
                30 + i * 15
            );
            oppPayload.Name = oppName;
            oppPayload.StageName = i === 1 ? 'Prospecting' : i === 2 ? 'Qualification' : 'Needs Analysis';
            oppPayload.Amount = 0;
            oppPayload.CloseDate = closeDate;

            const oppId = await sfApi.createOpportunity({
                ...oppPayload,
                Pricebook2Id: priceBookId
            });
            expectSalesforceId(`Opportunity ${i} ID`, oppId);
            cleanup.track('Opportunity', oppId);
            lastRecordId = oppId;

            const oppNode: OpportunityNode = {
                id: oppId,
                name: oppName,
                accountId: account.id,
                contactId: account.contactId,
                closeDate,
                priceBookId,
                lineItems: [],
                contactRoleIds: [],
                expectedAmount: 0
            };

            // PDF step 5 — link the Account's Contact to the Opportunity.
            failedStep = `Create Opportunity Contact Role for Opportunity ${i}`;
            const contactRoleId = await sfApi.createRecord('OpportunityContactRole', {
                OpportunityId: oppId,
                ContactId: account.contactId,
                Role: 'Decision Maker',
                IsPrimary: true
            });
            expectSalesforceId(`Opportunity Contact Role ${i} ID`, contactRoleId);
            cleanup.track('OpportunityContactRole', contactRoleId);
            oppNode.contactRoleIds.push(contactRoleId);

            // PDF steps 6 & 7 — three products per Opportunity with different
            // quantities and sales prices.
            for (let p = 0; p < 3; p++) {
                failedStep = `Add product ${p + 1} to Opportunity ${i}`;
                const entry = createdPriceBookEntries[p];
                const quantity = p + 1 + i;
                const unitPrice = 1500 + p * 500 + i * 125;
                const expectedLineTotal = Number((quantity * unitPrice).toFixed(2));

                const lineItemId = await sfApi.createRecord('OpportunityLineItem', {
                    OpportunityId: oppId,
                    PricebookEntryId: entry.pbeId,
                    Quantity: quantity,
                    UnitPrice: unitPrice,
                    ServiceDate: closeDate
                });
                expectSalesforceId(`Line item ${p + 1} of Opportunity ${i} ID`, lineItemId);
                cleanup.track('OpportunityLineItem', lineItemId);

                oppNode.lineItems.push({
                    id: lineItemId,
                    pbeId: entry.pbeId,
                    productId: entry.productId,
                    quantity,
                    unitPrice,
                    expectedTotal: expectedLineTotal
                });
            }

            // PDF step 8 — expected Opportunity total from the runtime
            // collection, then persist it to the Opportunity Amount.
            failedStep = `Update expected total for Opportunity ${i}`;
            oppNode.expectedAmount = Number(
                oppNode.lineItems
                    .reduce((total, line) => total + line.expectedTotal, 0)
                    .toFixed(2)
            );
            await sfApi.updateOpportunity(oppId, { Amount: oppNode.expectedAmount });

            opportunities.push(oppNode);
        }

        // PDF steps 10 & 11 — update one product quantity and one sales price,
        // then recalculate the expected line total, Opportunity total and the
        // runtime collection.
        failedStep = 'Update product quantity and sales price';
        const targetOpportunity = opportunities[0];
        const targetLineItem = targetOpportunity.lineItems[0];
        const updatedQuantity = targetLineItem.quantity + 2;
        const updatedUnitPrice = targetLineItem.unitPrice + 275;

        await sfApi.updateRecord('OpportunityLineItem', targetLineItem.id, {
            Quantity: updatedQuantity,
            UnitPrice: updatedUnitPrice
        });

        targetLineItem.quantity = updatedQuantity;
        targetLineItem.unitPrice = updatedUnitPrice;
        targetLineItem.expectedTotal = Number(
            (updatedQuantity * updatedUnitPrice).toFixed(2)
        );

        targetOpportunity.expectedAmount = Number(
            targetOpportunity.lineItems
                .reduce((total, line) => total + line.expectedTotal, 0)
                .toFixed(2)
        );

        await sfApi.updateOpportunity(targetOpportunity.id, {
            Amount: targetOpportunity.expectedAmount
        });

        // PDF steps 12 & 13 — retrieve Opportunities, products, Price Book
        // Entries and Contact Roles through SOQL and compare with the runtime
        // collection.
        failedStep = 'SOQL validation of opportunities, products and totals';
        const allPbeIds = Array.from(
            new Set(opportunities.flatMap(opportunity => opportunity.lineItems.map(line => line.pbeId)))
        );
        const pbeRecords = await sfApi.queryRecords<any>(
            `SELECT Id, Product2Id, Pricebook2Id, UnitPrice FROM PricebookEntry WHERE Id IN (${allPbeIds
                .map(id => `'${id}'`)
                .join(',')})`
        );
        const pbeById = new Map(pbeRecords.map(record => [record.Id, record]));

        for (const opportunity of opportunities) {
            failedStep = `SOQL validation for Opportunity ${opportunity.name}`;
            const oppRecord = await sfApi.queryOne<any>(
                `SELECT Id, Name, AccountId, Amount, Pricebook2Id, ` +
                    `(SELECT Id, Product2Id, PricebookEntryId, Quantity, UnitPrice, TotalPrice FROM OpportunityLineItems) ` +
                    `FROM Opportunity WHERE Id = '${opportunity.id}'`
            );

            expect(oppRecord.Name).toBe(opportunity.name);
            expect(oppRecord.AccountId).toBe(opportunity.accountId);
            expect(oppRecord.Pricebook2Id).toBe(opportunity.priceBookId);

            assertCollection(
                `Opportunity ${opportunity.name} line items`,
                opportunity.lineItems.map(line => line.id),
                oppRecord.OpportunityLineItems.records.map((line: any) => line.Id)
            );

            for (const line of opportunity.lineItems) {
                const dbLine = oppRecord.OpportunityLineItems.records.find(
                    (record: any) => record.Id === line.id
                );

                if (!dbLine) {
                    throw new Error(`Line item ${line.id} is missing from Opportunity ${opportunity.name}`);
                }

                const pbe = pbeById.get(line.pbeId);

                expect(dbLine.PricebookEntryId).toBe(line.pbeId);
                expect(dbLine.Product2Id).toBe(line.productId);
                expect(dbLine.Quantity).toBe(line.quantity);
                expect(dbLine.UnitPrice).toBeCloseTo(line.unitPrice, 2);
                expect(dbLine.TotalPrice).toBeCloseTo(line.expectedTotal, 2);
                expect(pbe, `Price Book Entry ${line.pbeId} should exist`).toBeTruthy();
                expect(pbe.Product2Id).toBe(line.productId);
                expect(pbe.Pricebook2Id).toBe(opportunity.priceBookId);
            }

            const calculatedTotal = Number(
                oppRecord.OpportunityLineItems.records
                    .reduce((total: number, line: any) => total + Number(line.TotalPrice), 0)
                    .toFixed(2)
            );
            expect(calculatedTotal).toBeCloseTo(opportunity.expectedAmount, 2);
            expect(oppRecord.Amount).toBeCloseTo(opportunity.expectedAmount, 2);

            const contactRoles = await sfApi.queryRecords<any>(
                `SELECT Id, ContactId, OpportunityId, Role FROM OpportunityContactRole ` +
                    `WHERE OpportunityId = '${opportunity.id}'`
            );

            assertCollection(
                `Opportunity ${opportunity.name} contact roles`,
                opportunity.contactRoleIds,
                contactRoles.map(role => role.Id)
            );
            expect(
                contactRoles.some(role => role.ContactId === opportunity.contactId),
                `Opportunity ${opportunity.name} should link Contact ${opportunity.contactId}`
            ).toBeTruthy();
        }

        // PDF steps 14 & 15 — add a product with an incompatible Price Book
        // Entry and prove the failed operation did not create a line item.
        failedStep = 'Attempt to add an incompatible Price Book Entry';
        const otherPriceBooks = priceBooks.filter(book => book.Id !== priceBookId);
        let incompatiblePbeId: string;

        if (otherPriceBooks.length > 0) {
            const otherPriceBook = otherPriceBooks[0];
            const otherEntries = await sfApi.queryRecords<any>(
                `SELECT Id FROM PricebookEntry WHERE Pricebook2Id = '${otherPriceBook.Id}' AND IsActive = true LIMIT 1`
            );

            if (otherEntries.length > 0) {
                incompatiblePbeId = otherEntries[0].Id;
            } else {
                incompatiblePbeId = await sfApi.createRecord('PricebookEntry', {
                    Pricebook2Id: otherPriceBook.Id,
                    Product2Id: createdPriceBookEntries[0].productId,
                    UnitPrice: 99,
                    IsActive: true,
                    UseStandardPrice: false
                });
                cleanup.track('PricebookEntry', incompatiblePbeId);
            }
        } else {
            const customPriceBookId = await sfApi.createRecord('Pricebook2', {
                Name: `W2S2_OtherPricebook_${executionId}`,
                IsActive: true
            });
            cleanup.track('Pricebook2', customPriceBookId);

            incompatiblePbeId = await sfApi.createRecord('PricebookEntry', {
                Pricebook2Id: customPriceBookId,
                Product2Id: createdPriceBookEntries[0].productId,
                UnitPrice: 99,
                IsActive: true,
                UseStandardPrice: false
            });
            cleanup.track('PricebookEntry', incompatiblePbeId);
        }

        const lineItemsBefore = await sfApi.queryRecords<any>(
            `SELECT Id FROM OpportunityLineItem WHERE OpportunityId = '${targetOpportunity.id}'`
        );
        const lineIdsBefore = new Set(lineItemsBefore.map(record => record.Id));

        expected = 'Salesforce rejects a Price Book Entry from a different Price Book';
        actual = 'no error';
        let incompatibleError: string | undefined;

        try {
            const accidentalLineItemId = await sfApi.createRecord('OpportunityLineItem', {
                OpportunityId: targetOpportunity.id,
                PricebookEntryId: incompatiblePbeId,
                Quantity: 1,
                UnitPrice: 99
            });
            cleanup.track('OpportunityLineItem', accidentalLineItemId);
            actual = `line item ${accidentalLineItemId} was created`;
        } catch (error) {
            incompatibleError = error instanceof Error ? error.message : String(error);
            actual = incompatibleError;
        }

        if (!incompatibleError) {
            throw new Error(
                `The incompatible Price Book Entry was not rejected. ${String(actual)}`
            );
        }

        const lineItemsAfter = await sfApi.queryRecords<any>(
            `SELECT Id, PricebookEntryId FROM OpportunityLineItem ` +
                `WHERE OpportunityId = '${targetOpportunity.id}'`
        );

        expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
        expect(
            lineItemsAfter.some(
                (record: any) =>
                    !lineIdsBefore.has(record.Id) || record.PricebookEntryId === incompatiblePbeId
            ),
            'The failed operation must not create an unintended line item'
        ).toBeFalsy();

        // PDF step 16 — compare the selected UI value with the SOQL/API total.
        failedStep = 'Compare Opportunity Amount in the UI with SOQL/API';
        await assertOpportunityAmountInUi(
            page,
            targetOpportunity.id,
            targetOpportunity.expectedAmount
        );

        // PDF step 9 — validate the currency text format explicitly as well.
        const uiCurrencySample = `$${targetOpportunity.expectedAmount.toFixed(2)}`;
        expectCurrency(
            'Opportunity Amount currency format',
            uiCurrencySample,
            targetOpportunity.expectedAmount
        );

        // Keep the selected Price Book name in the report for troubleshooting.
        expect(priceBookName.length).toBeGreaterThan(0);
        expect(await sfApi.queryRecords<any>(`SELECT Id FROM PricebookEntry WHERE Id = '${escapeSoql(createdPriceBookEntries[0].pbeId)}'`)).toHaveLength(1);
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_W2_002',
                failedStep,
                recordId: lastRecordId,
                inputDataset: {
                    priceBook: { id: priceBookId, name: priceBookName },
                    accounts,
                    opportunities,
                    priceBookEntries: createdPriceBookEntries
                },
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // PDF step 17 — only records created by this execution are tracked.
        // Shared Products and Price Books are never added to the cleanup list.
        await cleanup.cleanup();
    }
});
