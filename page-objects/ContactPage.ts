import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Contact-specific Lightning actions.
 * Demo link to the PDF: supports Scenario 2 step 8 (update a selected Contact's
 * Title through the UI).
 */
export class ContactPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async navigateToContact(contactId: string): Promise<void> {
        await this.navigateToRecord('Contact', contactId);
    }

    async updateTitleThroughUI(title: string): Promise<void> {
        await this.clickEditButton();
        await this.page.locator('input[name="Title"]:visible').first().fill(title);
        await this.saveRecord();
    }
}
