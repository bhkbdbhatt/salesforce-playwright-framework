import { Page } from '@playwright/test';
import { SalesforceService } from '../api/salesforceService';
import { resolveExecutionMode } from '../config/execution.config';
import { UiSalesforceService } from '../ui/uiSalesforceService';
import type { SalesforceOperations } from './salesforceOperations';

/**
 * Returns the Salesforce implementation selected in config/execution.config.ts.
 * Tests call this instead of constructing an API or UI service directly.
 *
 * This factory is what lets the PDF steps that mention "Playwright API" and the
 * steps that mention "Salesforce UI" share one test flow. Flip EXECUTION_MODE
 * (or set SF_EXECUTION_MODE) and every create/update/convert/delete step in all
 * five scenarios switches between REST/SOAP and the Lightning UI.
 */
export function createSalesforceService(page: Page): SalesforceOperations {
    if (resolveExecutionMode() === 'ui') {
        return new UiSalesforceService(page);
    }

    return new SalesforceService(page.request);
}
