/**
 * ============================================================================
 * WEEK 2 — SCENARIO 4
 * "Related Record Creation, API Failure, and Recovery"
 * Source: Week2.pdf (Scenario 4)
 * ----------------------------------------------------------------------------
 * Goal: create three customer datasets (Account + 2 Contacts + 2 Opportunities
 * each) with one Composite Graph per customer. Customer 2 contains one invalid
 * request. Verify the graph is atomic (nothing from Customer 2 is saved), then
 * correct the data, resubmit, verify recovery, validate through the UI and SOQL,
 * and clean up all created records.
 *
 * IMPORTANT: Salesforce's Composite Graph API is the only endpoint that gives
 * the all-or-nothing behaviour required by this scenario, so the graph write is
 * API-based in BOTH execution modes. The mode flag still controls the PDF's UI
 * verification and update steps through `SalesforceOperations`.
 *
 * PDF expected-automation step -> implementation:
 *   1. Login ............................... tests/auth.setup.ts
 *   2. Unique execution ID ................. createExecutionId('W2S4')
 *   3. >= 3 customer datasets .............. datasets loop (i = 1..3)
 *   4. 1 Account + 2 Contacts + 2 Opps ...... graph payload per customer
 *   5. Store datasets in Maps .............. `datasets` + `customerResults`
 *   6. One Composite Graph per customer .... compositeRequest builder
 *   7. Submit graphs (valid/invalid/valid) .. CompositeGraphClient.submit
 *   8. Capture results/IDs/errors ........... extractCreatedIds + summarizeGraphErrors
 *   9. Regex: execution/graph/names/IDs ..... patterns + expectMatches
 *  10. SOQL confirms valid + no Customer 2 .. relationship queries per customer
 *  11. Correct Customer 2 and resubmit ...... corrected graph + _Retry
 *  12. SOQL verifies recovery + no dupes .... account count + child collections
 *  13. Open Account in UI ................... assertRecordPageShows
 *  14. Update Contact/Opp through UI ........ sfApi.updateContact + SOQL check
 *  15. Clean up created records ............. utils/cleanupManager.ts (finally)
 *  16. Diagnostics + five clean runs ........ captureFailure + npm run test:repeat
 * ============================================================================
 */
import { test, expect } from '@playwright/test';
import {
    CompositeGraphClient,
    CompositeGraphDefinition,
    CompositeRequestItem,
    extractCreatedIds,
    summarizeGraphErrors
} from '../../api/compositeGraph';
import { createSalesforceService } from '../../services/salesforceServiceFactory';
import { CleanupManager } from '../../utils/cleanupManager';
import { captureFailure } from '../../utils/diagnostics';
import {
    assertCollection,
    assertRecordPageShows,
    createExecutionId,
    expectMatches,
    expectSalesforceId,
    futureDateIso
} from './support/week2Helpers';

const EXECUTION_ID_PATTERN = /^W2S4_\d{13}_[A-Z0-9]{4}$/;
const GRAPH_ID_PATTERN = /^W2S4_Customer_[123]_W2S4_\d{13}_[A-Z0-9]{4}(?:_Retry)?$/;

interface GraphContact {
    ref: string;
    name: string;
    payload: Record<string, unknown>;
}

interface GraphOpportunity {
    ref: string;
    name: string;
    payload: Record<string, unknown>;
}

interface CustomerDataset {
    index: number;
    graphId: string;
    accountRef: string;
    accountName: string;
    account: Record<string, unknown>;
    contacts: GraphContact[];
    opportunities: GraphOpportunity[];
    shouldSucceed: boolean;
}

interface CustomerResult {
    dataset: CustomerDataset;
    graphId: string;
    success: boolean;
    accountId?: string;
    contactIds: string[];
    opportunityIds: string[];
    errors: string[];
}

function buildGraph(
    dataset: CustomerDataset,
    graphId: string,
    accountRef: string,
    contactRefs: string[],
    opportunityRefs: string[],
    contactPayloads: Record<string, unknown>[],
    opportunityPayloads: Record<string, unknown>[]
): CompositeGraphDefinition {
    const requests: CompositeRequestItem[] = [
        {
            method: 'POST',
            url: `/services/data/${process.env.SF_API_VERSION || 'v60.0'}/sobjects/Account`,
            referenceId: accountRef,
            body: dataset.account
        }
    ];

    contactPayloads.forEach((payload, index) => {
        requests.push({
            method: 'POST',
            url: `/services/data/${process.env.SF_API_VERSION || 'v60.0'}/sobjects/Contact`,
            referenceId: contactRefs[index],
            body: payload
        });
    });

    opportunityPayloads.forEach((payload, index) => {
        requests.push({
            method: 'POST',
            url: `/services/data/${process.env.SF_API_VERSION || 'v60.0'}/sobjects/Opportunity`,
            referenceId: opportunityRefs[index],
            body: payload
        });
    });

    return { graphId, compositeRequest: requests };
}

test('TS_SF_W2_004: Related Record Creation, API Failure, and Recovery', async ({
    page
}, testInfo) => {
    test.setTimeout(900000);

    const sfApi = createSalesforceService(page);
    const graphClient = new CompositeGraphClient(page.request);
    const cleanup = new CleanupManager(sfApi);
    const executionId = createExecutionId('W2S4');

    expectMatches('Execution ID', executionId, EXECUTION_ID_PATTERN);

    const datasets: CustomerDataset[] = [];

    for (let i = 1; i <= 3; i++) {
        const graphId = `W2S4_Customer_${i}_${executionId}`;
        const accountRef = `${graphId}_Account`;
        const accountName = `W2S4_Customer_${i}_${executionId}_Account`;

        expectMatches(`Customer ${i} graph ID`, graphId, GRAPH_ID_PATTERN);

        const contacts: GraphContact[] = [1, 2].map(contactIndex => {
            const ref = `${graphId}_Contact_${contactIndex}`;
            const lastName = `W2S4_Customer_${i}_Contact_${contactIndex}_${executionId}`;
            return {
                ref,
                name: lastName,
                payload: {
                    FirstName: 'W2S4',
                    LastName: lastName,
                    Email: `w2s4.customer.${i}.contact.${contactIndex}.${Date.now()}@example.test`,
                    AccountId: `@{${accountRef}.Id}`
                }
            };
        });

        const opportunities: GraphOpportunity[] = [1, 2].map(opportunityIndex => {
            const ref = `${graphId}_Opportunity_${opportunityIndex}`;
            const name = `W2S4_Customer_${i}_Opportunity_${opportunityIndex}_${executionId}`;
            return {
                ref,
                name,
                payload: {
                    Name: name,
                    StageName: 'Prospecting',
                    Amount: 10000 * i + opportunityIndex * 5000,
                    CloseDate: futureDateIso(30 + i * 10 + opportunityIndex * 5),
                    AccountId: `@{${accountRef}.Id}`
                }
            };
        });

        // PDF step 7 — Customer 2 contains one intentionally invalid request.
        if (i === 2) {
            contacts[1].payload.LastName = '';
        }

        datasets.push({
            index: i,
            graphId,
            accountRef,
            accountName,
            account: {
                Name: accountName,
                Industry: 'Technology',
                Type: 'Customer',
                Rating: 'Hot'
            },
            contacts,
            opportunities,
            shouldSucceed: i !== 2
        });
    }

    const customerResults: CustomerResult[] = [];
    let failedStep = 'Initialization';
    let expected: unknown;
    let actual: unknown;
    let lastRecordId: string | undefined;

    const addCreatedRecordsToCleanup = (result: CustomerResult): void => {
        cleanup.track('Account', result.accountId);
        for (const contactId of result.contactIds) {
            cleanup.track('Contact', contactId);
        }
        for (const opportunityId of result.opportunityIds) {
            cleanup.track('Opportunity', opportunityId);
        }
    };

    try {
        // PDF steps 5, 6, 7 & 8 — submit one graph per customer in a single
        // Composite Graph call and capture every graph result, ID and error.
        failedStep = 'Submit Composite Graphs for all customers';
        const graphs = datasets.map(dataset =>
            buildGraph(
                dataset,
                dataset.graphId,
                dataset.accountRef,
                dataset.contacts.map(contact => contact.ref),
                dataset.opportunities.map(opportunity => opportunity.ref),
                dataset.contacts.map(contact => contact.payload),
                dataset.opportunities.map(opportunity => opportunity.payload)
            )
        );

        const graphResults = await graphClient.submit(graphs);

        for (const dataset of datasets) {
            const graphResult = graphResults.find(result => result.graphId === dataset.graphId);

            if (!graphResult) {
                throw new Error(`No Composite Graph result returned for ${dataset.graphId}.`);
            }

            const ids = extractCreatedIds(graphResult);
            const result: CustomerResult = {
                dataset,
                graphId: dataset.graphId,
                success: graphResult.isSuccessful,
                accountId: ids.get(dataset.accountRef),
                contactIds: dataset.contacts
                    .map(contact => ids.get(contact.ref))
                    .filter((id): id is string => Boolean(id)),
                opportunityIds: dataset.opportunities
                    .map(opportunity => ids.get(opportunity.ref))
                    .filter((id): id is string => Boolean(id)),
                errors: summarizeGraphErrors(graphResult)
            };

            customerResults.push(result);

            if (dataset.shouldSucceed) {
                expect(
                    result.success,
                    `Customer ${dataset.index} graph should succeed: ${result.errors.join('; ')}`
                ).toBeTruthy();
                expect(result.accountId, `Customer ${dataset.index} Account ID`).toBeTruthy();
                expect(result.contactIds).toHaveLength(2);
                expect(result.opportunityIds).toHaveLength(2);

                expectSalesforceId(`Customer ${dataset.index} Account ID`, result.accountId!);
                for (const id of [...result.contactIds, ...result.opportunityIds]) {
                    expectSalesforceId(`Customer ${dataset.index} child ID`, id);
                }

                lastRecordId = result.accountId;
                addCreatedRecordsToCleanup(result);
            } else {
                // PDF steps 8 & 10 — the invalid graph must fail atomically.
                // Successful subrequests in a rolled-back graph may still echo
                // their IDs in the response, so the SOQL check below proves the
                // records do not exist. If the graph unexpectedly succeeds, its
                // records are tracked for cleanup before the assertion fails.
                if (result.success) {
                    addCreatedRecordsToCleanup(result);
                }

                expect(
                    result.success,
                    `Customer ${dataset.index} invalid graph should fail`
                ).toBeFalsy();
                expect(result.errors.length, 'The invalid graph should report an error').toBeGreaterThan(0);
            }
        }

        // PDF step 10 — Customer 1 and Customer 3 must exist with the correct
        // relationships, and Customer 2's failed graph must leave no records.
        failedStep = 'SOQL validation of graph results';
        for (const result of customerResults) {
            const { dataset } = result;
            const accountRecords = await sfApi.queryRecords<any>(
                `SELECT Id, Name, ` +
                    `(SELECT Id, FirstName, LastName FROM Contacts), ` +
                    `(SELECT Id, Name FROM Opportunities) ` +
                    `FROM Account WHERE Name = '${dataset.accountName}'`
            );

            if (dataset.shouldSucceed) {
                expect(accountRecords).toHaveLength(1);
                const accountRecord = accountRecords[0];

                expect(accountRecord.Id).toBe(result.accountId);
                assertCollection(
                    `Customer ${dataset.index} contacts`,
                    result.contactIds,
                    accountRecord.Contacts.records.map((contact: any) => contact.Id)
                );
                assertCollection(
                    `Customer ${dataset.index} opportunities`,
                    result.opportunityIds,
                    accountRecord.Opportunities.records.map((opportunity: any) => opportunity.Id)
                );
            } else {
                expect(
                    accountRecords,
                    `Customer ${dataset.index}'s failed graph must not save any Account`
                ).toHaveLength(0);
            }
        }

        // PDF steps 11 & 12 — correct Customer 2's invalid Contact and resubmit
        // its graph, then verify recovery and the absence of duplicates.
        failedStep = 'Correct and resubmit Customer 2 graph';
        const failedCustomer = datasets.find(dataset => !dataset.shouldSucceed)!;
        const retryGraphId = `${failedCustomer.graphId}_Retry`;
        expectMatches('Customer 2 retry graph ID', retryGraphId, GRAPH_ID_PATTERN);

        const retryContacts = failedCustomer.contacts.map((contact, index) => ({
            ...contact,
            ref: `${retryGraphId}_Contact_${index + 1}`,
            payload: {
                ...contact.payload,
                LastName: contact.name
            }
        }));

        const retryOpportunities = failedCustomer.opportunities.map((opportunity, index) => ({
            ...opportunity,
            ref: `${retryGraphId}_Opportunity_${index + 1}`
        }));

        const retryAccountRef = `${retryGraphId}_Account`;
        const retryGraph = buildGraph(
            failedCustomer,
            retryGraphId,
            retryAccountRef,
            retryContacts.map(contact => contact.ref),
            retryOpportunities.map(opportunity => opportunity.ref),
            retryContacts.map(contact => ({
                ...contact.payload,
                AccountId: `@{${retryAccountRef}.Id}`
            })),
            retryOpportunities.map(opportunity => ({
                ...opportunity.payload,
                AccountId: `@{${retryAccountRef}.Id}`
            }))
        );

        const [retryResult] = await graphClient.submit([retryGraph]);
        expect(retryResult?.isSuccessful, 'Corrected Customer 2 graph should succeed').toBeTruthy();

        const retryIds = extractCreatedIds(retryResult);
        const retryCustomer: CustomerResult = {
            dataset: failedCustomer,
            graphId: retryGraphId,
            success: retryResult.isSuccessful,
            accountId: retryIds.get(retryAccountRef),
            contactIds: retryContacts
                .map(contact => retryIds.get(contact.ref))
                .filter((id): id is string => Boolean(id)),
            opportunityIds: retryOpportunities
                .map(opportunity => retryIds.get(opportunity.ref))
                .filter((id): id is string => Boolean(id)),
            errors: summarizeGraphErrors(retryResult)
        };

        expect(retryCustomer.accountId).toBeTruthy();
        expect(retryCustomer.contactIds).toHaveLength(2);
        expect(retryCustomer.opportunityIds).toHaveLength(2);
        expectSalesforceId('Customer 2 retry Account ID', retryCustomer.accountId!);
        addCreatedRecordsToCleanup(retryCustomer);
        lastRecordId = retryCustomer.accountId;

        const recoveredAccounts = await sfApi.queryRecords<any>(
            `SELECT Id, Name, ` +
                `(SELECT Id FROM Contacts), ` +
                `(SELECT Id FROM Opportunities) ` +
                `FROM Account WHERE Name = '${failedCustomer.accountName}'`
        );

        expect(recoveredAccounts, 'Customer 2 should have exactly one Account after recovery').toHaveLength(1);
        expect(recoveredAccounts[0].Id).toBe(retryCustomer.accountId);
        assertCollection(
            'Customer 2 recovered contacts',
            retryCustomer.contactIds,
            recoveredAccounts[0].Contacts.records.map((contact: any) => contact.Id)
        );
        assertCollection(
            'Customer 2 recovered opportunities',
            retryCustomer.opportunityIds,
            recoveredAccounts[0].Opportunities.records.map((opportunity: any) => opportunity.Id)
        );

        // PDF step 13 — open one created Account through the UI and validate
        // its related records.
        failedStep = 'Open an Account in the UI and validate related records';
        const uiCustomer = customerResults.find(result => result.success && result.accountId);
        if (!uiCustomer?.accountId) {
            throw new Error('No successful customer exists for the UI validation step.');
        }

        await assertRecordPageShows(page, 'Account', uiCustomer.accountId, [
            uiCustomer.dataset.accountName,
            uiCustomer.dataset.contacts[0].name,
            uiCustomer.dataset.opportunities[0].name
        ]);

        // PDF step 14 — update one Contact through the configured engine and
        // confirm the persisted value through SOQL.
        failedStep = 'Update a Contact and confirm through SOQL';
        const updatedTitle = `W2S4 Updated Contact ${executionId}`;
        await sfApi.updateContact(uiCustomer.contactIds[0], { Title: updatedTitle });

        expected = updatedTitle;
        const updatedContact = await sfApi.queryOne<any>(
            `SELECT Id, Title FROM Contact WHERE Id = '${uiCustomer.contactIds[0]}'`
        );
        actual = updatedContact.Title;
        expect(actual).toBe(expected);
    } catch (error) {
        await captureFailure(
            page,
            testInfo,
            {
                executionId,
                testName: 'TS_SF_W2_004',
                failedStep,
                recordId: lastRecordId,
                inputDataset: datasets,
                expected,
                actual
            },
            error
        );
        throw error;
    } finally {
        // PDF step 15 — cleanup all records that were successfully created.
        await cleanup.cleanup();
    }
});
