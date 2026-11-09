import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Account-specific Lightning actions.
 * Demo link to the PDF: supports Scenario 1 step 6 (New Opportunity from an
 * Account) and Scenario 4 steps 7-8 (open the Account, edit a child's Phone).
 */
export class AccountPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async navigateToAccount(accountId: string): Promise<void> {
        await this.navigateToRecord('Account', accountId);
    }

    async clickNewOpportunityButton(): Promise<void> {
        await this.chooseActionFromMenu('New Opportunity');
        await this.page
            .getByLabel('Opportunity Name')
            .first()
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    async fillOpportunityModal(name: string, amount: string, closeDate: string): Promise<void> {
        await this.page.getByLabel('Opportunity Name').first().fill(name);
        await this.page.getByLabel('Amount').first().fill(amount);
        await this.page.getByLabel('Close Date').first().fill(this.formatDateForUi(closeDate));
    }

    async saveOpportunity(): Promise<void> {
        await this.saveRecord();
    }

    async updatePhoneThroughUI(phone: string): Promise<void> {
        await this.clickEditButton();
        await this.page.locator('input[name="Phone"]:visible').first().fill(phone);
        await this.saveRecord();
    }
}
