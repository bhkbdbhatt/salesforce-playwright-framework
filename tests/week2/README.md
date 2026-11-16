# Week 2 — Salesforce Playwright Scenarios

Week 2 adds five advanced scenarios under `tests/week2/` (source: `Week2.pdf`). For framework architecture, setup, and auth details see the root [`README.md`](../../README.md).

## Contents

| Path | Purpose |
|---|---|
| `TS_SF_W2_001_account_hierarchies.spec.ts` | Scenario 1 — multiple account hierarchies and related records |
| `TS_SF_W2_002_opportunity_products.spec.ts` | Scenario 2 — multiple opportunities with products and pricing |
| `TS_SF_W2_003_lead_conversion.spec.ts` | Scenario 3 — data-driven lead creation and conditional conversion |
| `TS_SF_W2_004_composite_graph_recovery.spec.ts` | Scenario 4 — related record creation, API failure, and recovery |
| `TS_SF_W2_005_parallel_lifecycle.spec.ts` | Scenario 5 — parallel lead-to-sales lifecycle with recovery |
| `support/week2Helpers.ts` | Shared regex/ID/date helpers, collection diff/assert/report utilities, UI read/assert helpers |

## Scenarios

| Test | Title |
|---|---|
| `TS_SF_W2_001` | Multiple Account Hierarchies and Related Records |
| `TS_SF_W2_002` | Multiple Opportunities with Products and Pricing |
| `TS_SF_W2_003` | Data-Driven Lead Creation and Conditional Conversion |
| `TS_SF_W2_004` | Related Record Creation, API Failure, and Recovery |
| `TS_SF_W2_005` | Parallel Lead-to-Sales Lifecycle with Recovery |

## Prerequisites

1. Complete root setup: `npm install`, create `.env` from `.env.example`, and run `npm run auth:setup` (saves `.auth/user.json`).
2. Use a valid Salesforce org/My Domain with access for the objects used by these scenarios.
3. Tests run with `workers: 1` and `fullyParallel: false` (`playwright.config.ts`) to avoid shared-org collisions and API limits.

## Execution Model

- **Writes (create/update/convert/delete):** go through `SalesforceOperations` via `services/salesforceServiceFactory.ts`.
  - `api` (default): REST/SOAP-backed operations.
  - `ui`: Lightning UI-backed operations (mode set in `config/execution.config.ts` or overridden with `SF_EXECUTION_MODE`).
- **Read-only verification:** SOQL/REST GET checks always use the API as the backend source of truth.
- **Scenario 4 note:** the Composite Graph write is performed via Salesforce Composite Graph API in **both** modes to satisfy atomic all-or-nothing behavior; UI validation/update steps still follow the configured mode where applicable.
- **Scenario 5 note:** journeys run with isolated browser contexts (`browser.newContext` using `.auth/user.json`) so concurrent runs do not share state/records.

## Run Only Week 2 Tests

From the project root:

```powershell
# All Week 2 scenarios (runs setup dependency for session reuse/login)
npm run test:week2

# 5 consecutive runs per Week 2 test (PDF repeat requirement)
npm run test:week2:repeat
```

### Override execution mode

```powershell
# PowerShell
$env:SF_EXECUTION_MODE="ui"; npm run test:week2
$env:SF_EXECUTION_MODE="api"; npm run test:week2

# cmd.exe
set SF_EXECUTION_MODE=ui&& npm run test:week2
```

Or set the default in `config/execution.config.ts` (`EXECUTION_MODE = 'api' | 'ui'`).

### Run a single Week 2 spec or scenario

```powershell
# Single spec
npx playwright test tests/week2/TS_SF_W2_004_composite_graph_recovery.spec.ts --project=salesforce-e2e

# By test title / ID
npx playwright test tests/week2 --project=salesforce-e2e --grep "TS_SF_W2_002"

# Headed
npm run test:week2 -- --headed

# Playwright UI mode
npx playwright test tests/week2 --project=salesforce-e2e --ui

# Raw equivalent of npm scripts
npx playwright test tests/week2 --project=salesforce-e2e
npx playwright test tests/week2 --project=salesforce-e2e --repeat-each=5
```

> `--project=salesforce-e2e` ensures only Week 2 e2e specs run and the `setup` project executes first when needed.

## PDF Step-to-Test Mapping

Each spec includes a detailed header mapping; summary below.

### Scenario 1 — `TS_SF_W2_001_account_hierarchies.spec.ts`
| PDF step | Implementation |
|---|---|
| 1. Login | `tests/auth.setup.ts` via Playwright `storageState` |
| 2. Unique execution ID | `createExecutionId('W2S1')` + regex validation |
| 3–5. 2 parents, 2 children/parent, 3 contacts + 2 opportunities/child | Nested loops creating records via `sfApi.createAccount/Contact/Opportunity` |
| 6. Create with Playwright API | Writes through `SalesforceOperations` (API or UI by mode) |
| 7. Nested Map/Collection | In-memory parent/child/contact/opportunity tree |
| 8. Regex validation | Execution/account/email/record ID pattern checks |
| 9. Navigate hierarchy through UI | `assertRecordPageShows` for parent/child pages |
| 10–11. Update 2 contacts + 2 opportunities & runtime collection | `sfApi.updateContact/updateOpportunity` and expected-value updates in collection |
| 12–13. Execute SOQL & validate associations/updates | Hierarchy/subqueries, ID/ParentId/value assertions |
| 14. Detect missing/duplicate/mislinked | `collectCollectionIssues` and reporting |
| 15. Cleanup in dependency order | `CleanupManager` in `finally` |
| 16. Diagnostics + five clean runs | `captureFailure`, JSON/attachments, `npm run test:week2:repeat` |

### Scenario 2 — `TS_SF_W2_002_opportunity_products.spec.ts`
| PDF step | Implementation |
|---|---|
| 1–2. Login & execution ID | `auth.setup.ts`, `createExecutionId('W2S2')` |
| 3–6. Accounts/contacts/opportunities/products/line items/roles | Data setup loops; product/PBE/line item/contact-role creation via generic/service operations |
| 7–8. Different quantities/prices & stored totals | Runtime collection with IDs, prices, expected totals |
| 9. Regex (names/IDs/currency) | Pattern checks + currency/amount helpers |
| 10–11. Update quantity/price & recalculate totals | `updateRecord` for line items, recompute expectations, update Opportunity amounts |
| 12–13. SOQL validation of relationships/totals | Relationship/IN queries and collection equality checks |
| 14–15. Incompatible PBE negative case | Attempt with incompatible Price Book, expect rejection and verify no unintended line item |
| 16. Compare UI with SOQL/API | `readOpportunityAmountFromUi` / `assertOpportunityAmountInUi` |
| 17. Cleanup without deleting shared data | Tracks only records created by the test (shared products/price books not deleted) |
| 18. Diagnostics + repeat | `captureFailure`, reports/attachments, repeat command |

### Scenario 3 — `TS_SF_W2_003_lead_conversion.spec.ts`
| PDF step | Implementation |
|---|---|
| 1–3. Login, execution ID, 6 datasets | `auth.setup.ts`, `createExecutionId('W2S3')`, varied dataset definitions |
| 4. Eligible/unconverted/invalid/duplicate mix | Dataset `kind`/outcome expectations |
| 5–6. Store datasets/outcomes & create leads | Runtime relationship collection and `sfApi.createLead` |
| 7–8. Regex & duplicate detection | Email/company/ID checks; Email+Company duplicate criterion and SOQL checks |
| 9–11. Duplicate behavior, convert eligible, capture IDs | Blocked/rejected handling, `sfApi.convertLead`, store Account/Contact/Opportunity IDs |
| 12–16. Lead→A→C→O validation (SOQL + UI/API compare) | Status/relationship/value checks, `assertRecordPageShows`, REST/SOQL comparisons |
| 17. Continue after dataset failure | Per-dataset `try/catch` |
| 18. Outcome report | JSON report attached via `TestInfo` (`converted/unconverted/rejected/failed`) |
| 19–20. Cleanup, undeletable converted leads, diagnostics | Reconcile/cleanup handling, failure diagnostics, repeat runs |

### Scenario 4 — `TS_SF_W2_004_composite_graph_recovery.spec.ts`
| PDF step | Implementation |
|---|---|
| 1–2. Login & execution ID | `auth.setup.ts`, `createExecutionId('W2S4')` |
| 3–6. 3 customers, 1 Account+2 Contacts+2 Opps each, graph per customer | Dataset/graph builders and Maps |
| 7–9. Submit graphs, capture IDs/errors, regex checks | `CompositeGraphClient.submit`, `extractCreatedIds`, `summarizeGraphErrors`, pattern assertions |
| 10. SOQL confirms valid + no Customer 2 data | Relationship queries and atomic rollback verification |
| 11–12. Correct/resubmit Customer 2 & verify recovery/no duplicates | Retry graph submission and SOQL validation |
| 13–14. UI validation and UI-driven update | `assertRecordPageShows`, `sfApi.updateContact`/related checks |
| 15–16. Cleanup & diagnostics | `CleanupManager` in `finally`, `captureFailure`, repeat runs |

**Mode note:** Composite Graph submission is API-based in both modes (required for atomic semantics); UI mode still applies to UI verification/update steps.

### Scenario 5 — `TS_SF_W2_005_parallel_lifecycle.spec.ts`
| PDF step | Implementation |
|---|---|
| 1–2. Login & suite/journey IDs | `auth.setup.ts`, `createExecutionId('W2S5')` + `_J1.._J5` |
| 3–5. 5 datasets, >=3 concurrent isolated contexts, per-journey collections | Journey definitions, `runWithConcurrency(limit=3)`, isolated `browser.newContext` + per-journey service/cleanup |
| 6–11. Create/convert leads, capture IDs, add contacts/opps/roles, update opportunity | Service operations and OpportunityContactRole creation |
| 12–14. Regex checks & controlled failures, continue unaffected journeys | Pattern assertions; invalid/interruption/recoverable cases with per-journey `try/catch` |
| 15. Resume interrupted journey | Resume via stored Lead ID/SOQL state and complete flow |
| 16–17. SOQL validation & no cross-journey mixing/missing/duplicates | Relationship queries, collection/global ID checks |
| 18. Journey-level report | JSON report attached to `TestInfo` |
| 19–20. Cleanup completed/partial journeys & diagnostics | Per-journey cleanup in `finally`, `captureFailure`, repeat runs |

## Outputs & Diagnostics

- **Week 2 JSON reports:** written under `test-results/week2/` (e.g. scenario outcome/journey reports) and attached to Playwright `TestInfo`.
- **Failure diagnostics:** `captureFailure` artifacts (see `utils/diagnostics.ts`), plus Playwright traces/screenshots/videos retained on failure (`playwright.config.ts`).
- **HTML report:** `npx playwright show-report`.

## Troubleshooting & Notes

- **`401 INVALID_SESSION_ID` / expired session:** re-run `npm run auth:setup` (or delete `.auth/user.json` and authenticate again).
- **UI mode failures/timeouts:** Lightning selectors and save timing can vary by org; inspect trace/screenshot and adjust page objects/selectors or timeouts as needed.
- **Shared records:** Scenario 2 does not delete shared products/price books created outside test ownership assumptions; cleanup targets records created by the test.
- **Converted Leads:** converted Leads may not be deletable; cleanup reconciles to generated Account/Contact/Opportunity records where applicable.
- **Week 1 unchanged:** Week 1 specs remain in `tests/` root (`TS_SF_001_*`–`TS_SF_005_*`) and are excluded when running `tests/week2`.
- **Live validation required:** runtime behavior depends on org configuration, permissions, and data; run targeted specs or `npm run test:week2` against the configured org after static checks.
