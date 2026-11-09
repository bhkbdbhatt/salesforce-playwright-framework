import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LeadPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async navigateToLead(leadId: string): Promise<void> {
        await this.navigateToRecord('Lead', leadId);
    }

    async convertLeadThroughUI(): Promise<void> {
        const convertButton = this.page
            .locator('button[name="Lead.Convert"], button:has-text("Convert")')
            .first();
        await convertButton.waitFor({ state: 'visible', timeout: 15000 });
        await convertButton.click();
        await this.waitForLightningSpinnerToDisappear();

        const modalConvertButton = this.page
            .locator('.slds-modal button:has-text("Convert"), .slds-modal button.slds-button_brand')
            .last();

        if (await modalConvertButton.isVisible({ timeout: 10000 }).catch(() => false)) {
            await modalConvertButton.click();
        } else {
            const fallbackConvertButton = this.page.locator('button:has-text("Convert"):visible').last();
            await fallbackConvertButton.waitFor({ state: 'visible', timeout: 10000 });
            await fallbackConvertButton.click();
        }

        await this.waitForLightningSpinnerToDisappear();

        const closeButton = this.page
            .locator('.slds-modal button:has-text("Close"), .slds-modal button[title="Close"]')
            .first();
        if (await closeButton.isVisible({ timeout: 10000 }).catch(() => false)) {
            await closeButton.click();
            await this.waitForLightningSpinnerToDisappear();
        }
    }
}
