import { Page } from '@playwright/test';
import { SalesforceService } from '../api/salesforceService';
import { resolveExecutionMode } from '../config/execution.config';
import { UiSalesforceService } from '../ui/uiSalesforceService';
import type { SalesforceOperations } from './salesforceOperations';

/**
 * Returns the Salesforce implementation selected in config/execution.config.ts.
 * Tests call this instead of constructing an API or UI service directly.
 */
export function createSalesforceService(page: Page): SalesforceOperations {
    if (resolveExecutionMode() === 'ui') {
        return new UiSalesforceService(page);
    }

    return new SalesforceService(page.request);
}
