# Salesforce Playwright E2E Automation Framework

A Salesforce test automation framework built with **Playwright + TypeScript** that can run the same scenarios through **two interchangeable engines**:

- **API mode** — create, update, convert and delete records through the Salesforce REST/SOAP APIs.
- **UI mode** — perform the exact same operations through the Salesforce Lightning UI.

The engine is chosen by a single flag in a dedicated config file, so the test code never changes. Backend verification (SOQL and REST GET) always runs through the API, because SOQL has no UI equivalent.

The suite covers Account, Contact, Opportunity, Lead, Lead Conversion, multi-record validation, account hierarchies, and a complete Lead-to-sales lifecycle.

---

## 1. What This Project Demonstrates

- A single test suite that can execute through the API or the Lightning UI
- An interface + factory design that keeps UI code and API code completely segregated
- Data-driven and multi-record test design
- SOQL relationship validation between Salesforce objects
- Authentication session reuse through Playwright `storageState`
- Dynamic, execution-scoped test data
- Dynamic cleanup in reverse dependency order, including converted Leads
- Failure diagnostics with screenshots, failed step, expected/actual values, and JSON output

---

## 2. Tech Stack

| Component | Technology |
|---|---|
| Test framework | Playwright Test |
| Language | TypeScript (strict mode) |
| Browser | Google Chrome (`channel: 'chrome'`) |
| CRM | Salesforce Lightning / Developer Org |
| API | Salesforce REST API (`v60.0`) + SOAP `convertLead` |
| Query language | SOQL |
| Config | dotenv + a TypeScript config file |
| Reporting | Playwright HTML report, optional TestDino |

---

## 3. Architecture

The framework is split by responsibility so API and UI code never mix:

```text
salesforce-playwright-framework/
├── .auth/
│   └── user.json                     # Saved Salesforce session (gitignored)
├── api/                              # API-only code
│   ├── sfApiClient.ts                # REST transport (create/update/delete/get/query)
│   ├── salesforceService.ts          # API implementation of SalesforceOperations
│   ├── soapLeadConverter.ts          # SOAP convertLead (no REST equivalent)
│   ├── soqlQueries.ts                # Reusable SOQL builders
│   └── sessionState.ts               # Reads the session ID from storageState
├── config/
│   └── execution.config.ts           # >>> Execution mode flag lives here <<<
├── services/                         # Engine-agnostic contracts and factory
│   ├── salesforceOperations.ts       # Interface implemented by both engines
│   └── salesforceServiceFactory.ts   # Chooses API or UI from the config flag
├── ui/                               # UI-only code
│   └── uiSalesforceService.ts        # UI implementation of SalesforceOperations
├── page-objects/                     # Lightning UI interactions
│   ├── BasePage.ts                   # Navigation, create/edit/delete, save, fields
│   ├── AccountPage.ts
│   ├── ContactPage.ts
│   ├── OpportunityPage.ts
│   └── LeadPage.ts
├── tests/
│   ├── auth.setup.ts                 # Login and session validation
│   ├── TS_SF_001_lifecycle.spec.ts
│   ├── TS_SF_002_multi_records.spec.ts
│   ├── TS_SF_003_data_driven_lead.spec.ts
│   ├── TS_SF_004_account_hierarchy.spec.ts
│   └── TS_SF_005_full_lifecycle.spec.ts
├── utils/
│   ├── testDataGenerator.ts          # Unique test data generation
│   ├── cleanupManager.ts             # Reverse-order record cleanup
│   └── diagnostics.ts                # Failure screenshots and JSON diagnostics
├── .env.example
├── playwright.config.ts
├── package.json
└── tsconfig.json
```

The tests only import `SalesforceOperations` through the factory. They never import page objects or API clients directly, so both code paths stay isolated.

---

## 4. Execution Modes (API vs UI)

All scenarios use one switch:

```ts
// config/execution.config.ts
export const EXECUTION_MODE: ExecutionMode = 'api'; // change to 'ui'
```

| Mode | Create | Update | Convert Lead | Delete / Cleanup | Verification |
|---|---|---|---|---|---|
| `api` | REST | REST | SOAP `convertLead` | REST | SOQL + REST GET |
| `ui` | Lightning "New" page | Lightning edit page | Lightning Convert flow | Lightning action menu | SOQL + REST GET |

Notes:

- In **UI mode**, record creation uses the Lightning `defaultFieldValues` URL parameter, then saves through the UI form. Edits and deletes use the real Lightning edit page and action menu. Lead conversion uses the Lightning Convert flow and then reads back the generated IDs through SOQL.
- In **UI mode**, read-only verification still goes through the API. SOQL is a backend query language and cannot be exercised meaningfully through the UI.
- The config file is the source of truth. An optional `SF_EXECUTION_MODE` environment variable can override it for CI without editing the file.

Example:

```ts
// config/execution.config.ts
export const EXECUTION_MODE: ExecutionMode = 'ui';
```

Then run the suite as usual — no test changes are required.

---

## 5. Prerequisites

1. **Node.js 18 or newer**
2. **npm**
3. **Google Chrome installed** (the framework uses Playwright `channel: 'chrome'`)
4. **A Salesforce Developer Org**
5. **Valid Salesforce credentials**
6. **Access to complete MFA** during the first login

```powershell
node --version
npm --version
```

---

## 6. One-Time Setup

### Step 1: Install dependencies

```powershell
npm install
```

### Step 2: Create the `.env` file

```powershell
Copy-Item .env.example .env
```

Edit `.env` and fill in your org details:

```env
SF_BASE_URL=https://your-domain.my.salesforce.com
SF_USERNAME=your_username@example.com
SF_PASSWORD=your_password
```

> Use your Salesforce **My Domain** URL, not `login.salesforce.com`.

### Step 3: Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SF_BASE_URL` | Yes | Salesforce My Domain URL |
| `SF_USERNAME` | Yes | Salesforce username |
| `SF_PASSWORD` | Yes | Salesforce password |
| `SF_API_VERSION` | No | REST API version, defaults to `v60.0` |
| `SF_API_TIMEOUT_MS` | No | Per-request REST/SOAP timeout, defaults to `60000` |
| `SF_EXECUTION_MODE` | No | Overrides `EXECUTION_MODE` from `config/execution.config.ts` |
| `SF_FORCE_LOGIN` | No | Set to `true` to force a fresh interactive login |
| `SF_LOGIN_TIMEOUT_MS` | No | Login wait timeout, defaults to `30000` |
| `SF_MFA_TIMEOUT_MS` | No | MFA wait timeout, defaults to `300000` |
| `SF_MFA_PAUSE` | No | Set to `true` to pause for manual MFA |
| `TESTDINO_TOKEN` | No | Enables the optional TestDino reporter |

### Step 4: Authenticate

```powershell
npm run auth:setup
```

What happens:

1. Chrome opens and navigates to your Salesforce org.
2. The framework enters the username, then the password (two-step login).
3. If MFA/verification appears, complete it in the browser window.
4. The authenticated session is saved to `.auth/user.json`.
5. The session is validated against the Salesforce REST API.

On later runs, a valid saved session is reused automatically and login is skipped.

Force a fresh login:

```powershell
$env:SF_FORCE_LOGIN="true"; npm run auth:setup
```

---

## 7. Running the Tests

Run the full suite (uses the mode configured in `config/execution.config.ts`):

```powershell
npm test
```

Run a single scenario:

```powershell
npx playwright test tests/TS_SF_001_lifecycle.spec.ts --project=salesforce-e2e --reporter=line
```

Force a mode for one run without editing the config file:

```powershell
$env:SF_EXECUTION_MODE="ui"; npm test
$env:SF_EXECUTION_MODE="api"; npm test
```

Run in headed mode, repeat for flakiness, or type-check:

```powershell
npm run test:headed
npm run test:repeat
npm run typecheck
```

> Tests run with `workers: 1` and `fullyParallel: false`. This avoids Salesforce API limits, record collisions, and shared-org interference.

---

## 8. Test Scenarios

Every scenario is written against `SalesforceOperations`, so all of them run in either mode.

| Test | Scenario | Key Validation |
|---|---|---|
| `TS_SF_001` | Account, Contact and Opportunity lifecycle | Creates Account/Contact/Opportunity, updates Opportunity Stage/Amount/Close Date, validates relationships and values with SOQL + REST GET |
| `TS_SF_002` | Multiple Contacts and Opportunities | Creates 3 Contacts and 3 Opportunities, updates one Contact and one Opportunity, verifies collections, duplicates and updates |
| `TS_SF_003` | Data-driven Lead creation and conversion | Builds 5 Lead datasets, converts eligible Leads, captures generated Account/Contact/Opportunity IDs, validates converted and unconverted states |
| `TS_SF_004` | Multi-level Account hierarchy | Creates a parent Account, two child Accounts, Contacts and Opportunities, updates a child Account, validates the hierarchy through SOQL |
| `TS_SF_005` | Complete Lead-to-sales lifecycle | Converts Leads, adds Contacts/Opportunities, updates an Opportunity, validates the full relationship graph and business values |

---

## 9. How the Framework Works

### 9.1 Authentication and session reuse

`tests/auth.setup.ts` logs in once and saves the browser state to `.auth/user.json`.

On later runs it validates the stored session against:

```text
/services/data/
```

using the Salesforce session ID as a Bearer token. If the session is valid, login is skipped; otherwise it logs in again.

The Lightning home page is not a reliable auth check because it can return HTTP 200 without a valid session. The REST API correctly returns `401` for an expired session.

### 9.2 Engine-agnostic contract and factory

`services/salesforceOperations.ts` defines the operations used by the tests:

```ts
export interface SalesforceOperations {
  createAccount(data): Promise<string>;
  updateOpportunity(recordId, data): Promise<void>;
  convertLead(leadId, options): Promise<LeadConvertResult>;
  getFullSalesLifecycle(accountId): Promise<any>;
  // ...
}
```

`services/salesforceServiceFactory.ts` picks the implementation:

```ts
export function createSalesforceService(page: Page): SalesforceOperations {
  if (resolveExecutionMode() === 'ui') {
    return new UiSalesforceService(page);
  }
  return new SalesforceService(page.request);
}
```

Tests create the service like this:

```ts
const sfApi = createSalesforceService(page);
```

Because both engines implement the same interface, a test never knows which one is active.

### 9.3 API implementation (`api/`)

`SalesforceService` delegates to:

- `SfApiClient` — REST create/update/delete/get/query with Bearer auth and configurable timeout.
- `SoapLeadConverter` — SOAP `convertLead`, because Salesforce has no standard REST lead-conversion endpoint.
- `SoqlQueries` — reusable SOQL builders.

This is the default mode.

### 9.4 UI implementation (`ui/` + `page-objects/`)

`UiSalesforceService` implements the same interface through Lightning:

- **Create** — opens `/lightning/o/{Object}/new?defaultFieldValues=...`, then saves through the form. Record IDs are read from the resulting record URL.
- **Update** — opens `/lightning/r/{Object}/{id}/edit`, fills fields by name (text, date, picklist combobox), and saves.
- **Delete** — opens the record page, uses the action menu, and confirms the delete dialog.
- **Convert Lead** — uses the existing Lightning convert flow, then reads the generated Account/Contact/Opportunity IDs through SOQL.

The reusable UI mechanics live in `page-objects/BasePage.ts` (`createRecord`, `editRecord`, `deleteRecord`, `setFieldValue`). Object-specific page objects add focused actions such as `OpportunityPage.updateStageAmountAndCloseDate()` and `LeadPage.convertLeadThroughUI()`.

### 9.5 SOQL-based backend validation

Verification always uses the API, in both modes, so the checks are identical:

```ts
const account = await sfApi.getFullSalesLifecycle(accountId);

expect(account.Contacts.records[0].Id).toBe(contactId);
expect(account.Opportunities.records[0].StageName).toBe('Negotiation/Review');
```

REST GETs provide a second, independent read path:

```ts
const opportunity = await sfApi.getRecord('Opportunity', opportunityId, ['StageName', 'Amount']);
```

### 9.6 Cleanup

`CleanupManager` tracks every created record and deletes them in reverse dependency order:

```text
Opportunity -> Contact -> Account -> Lead
```

Converted Leads cannot be deleted, so `reconcileTrackedLeads()` expands a converted Lead into its generated Account, Contact, and Opportunity before cleanup.

In API mode, deletion uses REST. In UI mode, deletion uses the Lightning action menu. Cleanup always runs in a `finally` block, so it executes even when a test fails.

### 9.7 Failure diagnostics

When a test fails, `captureFailure()` records:

- Execution ID, test name, and failed step
- Record ID and input dataset
- Expected and actual values
- Page URL, error message, and stack trace
- A full-page screenshot

Outputs are written to `test-results/diagnostics/`. Playwright traces, screenshots, and videos are also retained on failure.

---

## 10. Switching Modes: Checklist

1. Open `config/execution.config.ts`.
2. Set `EXECUTION_MODE` to `'api'` or `'ui'`.
3. Run `npm test`.

Or override per run:

```powershell
$env:SF_EXECUTION_MODE="ui"; npm test
```

No test files need to change because they only depend on `SalesforceOperations`.

---

## 11. Troubleshooting

### Login hangs or waits for verification

MFA is likely required. Complete it in the browser window, or use:

```powershell
$env:SF_MFA_PAUSE="true"; npm run auth:setup
```

Then click **Resume** in the Playwright Inspector after completing MFA.

### Salesforce returns `401 INVALID_SESSION_ID`

The saved session is expired or incomplete. Delete `.auth/user.json` and run:

```powershell
npm run auth:setup
```

### UI mode fails on a field

Salesforce Lightning changes its DOM regularly. Inspect the failure screenshot or trace, then update the relevant page object or the `setFieldValue` locator in `BasePage`. Prefer accessible selectors such as `getByLabel()` and role-based locators.

### UI mode times out on a save

Live Salesforce UI flows can take longer than default timeouts. Increase the timeout in `playwright.config.ts`, or set `SF_API_TIMEOUT_MS` for API requests.

### Cleanup reports errors

Some Salesforce records cannot be deleted, such as converted Leads. The framework expands converted Leads into their generated records before cleanup. Check the diagnostic JSON for the affected record IDs.

### SOQL validation still runs in UI mode

This is intentional. SOQL is the backend source of truth and has no UI equivalent. UI mode changes how records are written, not how they are verified.

### Traces contain sensitive information

Do not share raw traces or `.auth/user.json`. The auth setup project disables trace and video because the login flow contains a password.

---

## 12. Security Notes

- Never commit `.env` or `.auth/`.
- Both are listed in `.gitignore`.
- Keep the Salesforce password only in `.env`.
- Do not paste session IDs, cookies, or traces into tickets or chat.
- Rotate credentials immediately if they are exposed.
- Setup traces and videos are disabled to avoid recording the login password.

---

## 13. Useful Commands Reference

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run auth:setup` | Open Chrome, log in, and save the session |
| `npm test` | Run setup plus all five scenarios in the configured mode |
| `npm run test:headed` | Run with a visible browser |
| `npm run test:repeat` | Run the e2e project five times |
| `npm run typecheck` | Run the TypeScript compiler |
| `npx playwright show-report` | Open the HTML report |
| `npx playwright test --ui` | Open Playwright UI mode |
| `$env:SF_EXECUTION_MODE="ui"; npm test` | Run the suite through the Lightning UI |
| `$env:SF_EXECUTION_MODE="api"; npm test` | Run the suite through the Salesforce APIs |

---

## 14. How to Explain This Project to an Interviewer

> This is a Salesforce end-to-end automation framework built with Playwright and TypeScript. The same test suite can drive Salesforce through either its APIs or its Lightning UI, selected by one flag in a config file.
>
> UI code, API code, and test code are fully separated. Tests depend only on a `SalesforceOperations` interface, and a factory injects the API-backed or UI-backed implementation. That keeps the tests readable and makes the execution strategy a configuration detail instead of a rewrite.
>
> Regardless of the mode, SOQL and REST GETs validate that the data actually persisted and that relationships are correct. Every test generates unique data, tracks created records, cleans them up in reverse dependency order, and captures detailed diagnostics on failure.

Key points to highlight:

- **Single interface, two engines** — API and UI are interchangeable without touching tests.
- **True separation of concerns** — `api/`, `ui/`, `page-objects/`, and `services/` each own one responsibility.
- **SOQL as backend truth** — UI assertions only prove the screen looks right; SOQL proves persistence.
- **Reliable auth** — session reuse validated through the REST API, not the Lightning home page.
- **Cleanup as a first-class concern** — including the special handling required for converted Leads.
- **Diagnosability** — execution IDs, failed-step tracking, expected/actual values, screenshots, traces, and JSON diagnostics.

---

## 15. Summary

This framework is built around three ideas:

1. **The strategy is configurable** — one flag selects API or UI execution for all data operations.
2. **Verification is consistent** — SOQL and REST GETs validate backend state in both modes.
3. **The code stays maintainable** — a shared interface, a factory, segregated API/UI layers, generated test data, and automated cleanup.

That combination is the story to tell: not just "I wrote Playwright tests," but "I designed a maintainable, reliable Salesforce automation approach where execution strategy is a configuration choice."
