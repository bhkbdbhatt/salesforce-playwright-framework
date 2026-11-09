import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class OpportunityPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async navigateToOpportunity(opportunityId: string): Promise<void> {
        await this.navigateToRecord('Opportunity', opportunityId);
    }

    async updateStageAmountAndCloseDate(
        stageName: string,
        amount: string,
        closeDate: string
    ): Promise<void> {
        await this.clickEditButton();

        const stageCombobox = this.page
            .locator(
                'button[name="StageName"]:visible, lightning-combobox[name="StageName"] input:visible, input[name="StageName"]:visible'
            )
            .first();
        await stageCombobox.waitFor({ state: 'visible', timeout: 15000 });
        await stageCombobox.click();

        const stageOption = this.page
            .locator(
                `lightning-base-combobox-item[data-value="${stageName}"]:visible, [role="option"]:visible:has-text("${stageName}")`
            )
            .first();
        await stageOption.waitFor({ state: 'visible', timeout: 10000 });
        await stageOption.click();

        await this.page.locator('input[name="Amount"]:visible').first().fill(amount);
        await this.page.locator('input[name="CloseDate"]:visible').first().fill(closeDate);

        await this.saveRecord();
    }
}
