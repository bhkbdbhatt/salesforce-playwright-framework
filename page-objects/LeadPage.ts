import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Lead-specific Lightning actions.
 * Demo link to the PDF: convertLeadThroughUI() supports Scenario 3 step 7 and
 * Scenario 5 step 7 in 'ui' mode (the API/SOAP equivalent is SoapLeadConverter).
 */
export class LeadPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async navigateToLead(leadId: string): Promise<void> {
        await this.navigateToRecord('Lead', leadId);
    }

    async convertLeadThroughUI(): Promise<void> {
        // The Convert action lives in the record page's "Show more actions" menu.
        await this.chooseActionFromMenu('Convert');

        const convertModal = this.page
            .locator('.slds-modal, section[role="dialog"]')
            .filter({ hasText: 'Converted Status' })
            .first();
        await convertModal.waitFor({ state: 'visible', timeout: 15000 });

        const modalConvertButton = convertModal.locator('button:has-text("Convert")').last();
        await modalConvertButton.waitFor({ state: 'visible', timeout: 10000 });
        await modalConvertButton.click();
        await this.waitForLightningSpinnerToDisappear();

        // Wait for the confirmation panel so the converted IDs are available.
        await this.page
            .getByText('Your lead has been converted')
            .first()
            .waitFor({ state: 'visible', timeout: 30000 });
    }
}
