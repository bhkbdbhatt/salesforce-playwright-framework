import { Page } from '@playwright/test';

/**
 * Shared Lightning UI mechanics used when EXECUTION_MODE='ui'.
 *
 * Demo link to the PDF: createRecord/editRecord/deleteRecord below implement the
 * "through Salesforce UI" variants of the create, update and cleanup steps used
 * across all five scenarios. In 'api' mode these same steps are served by the
 * REST client instead, so the scenarios themselves never change.
 *
 * Lightning renderers do not always expose the API field name on the control.
 * Map the API field names used by the tests to the labels rendered in the UI.
 */
const FIELD_LABELS: Record<string, string> = {
    StageName: 'Stage',
    LeadSource: 'Lead Source',
    AccountId: 'Account Name',
    ParentId: 'Parent Account',
    OwnerId: 'Opportunity Owner'
};

const DATE_FIELDS = new Set(['CloseDate', 'ActivityDate']);

export class BasePage {
    protected page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    async waitForLightningSpinnerToDisappear(timeout = 15000): Promise<void> {
        const spinner = this.page.locator('.slds-spinner').first();
        try {
            await spinner.waitFor({ state: 'hidden', timeout });
        } catch {
            // The spinner may never appear or may already be gone; continue.
        }
    }

    async navigateToRecord(objectApiName: string, recordId: string): Promise<void> {
        await this.page.goto(`/lightning/r/${objectApiName}/${recordId}/view`);
        await this.waitForLightningSpinnerToDisappear();
    }

    async clickEditButton(): Promise<void> {
        const directEditButton = this.page
            .locator('button[name="Edit"]:visible, a[title="Edit"]:visible')
            .first();

        if (await directEditButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await directEditButton.click();
        } else {
            await this.chooseActionFromMenu('Edit');
        }

        await this.waitForLightningSpinnerToDisappear();
    }

    async chooseActionFromMenu(actionName: string): Promise<void> {
        const moreActionsButton = this.page
            .getByRole('button', { name: /show more actions/i })
            .first();
        await moreActionsButton.waitFor({ state: 'visible', timeout: 15000 });
        await moreActionsButton.click();

        const menuItem = this.page
            .locator(
                `[role="menu"] a:has-text("${actionName}"), [role="menu"] button:has-text("${actionName}"), [role="menuitem"]:has-text("${actionName}")`
            )
            .first();
        await menuItem.waitFor({ state: 'visible', timeout: 10000 });
        await menuItem.click();
        await this.waitForLightningSpinnerToDisappear();
    }

    async saveRecord(): Promise<void> {
        const saveButton = this.page
            .locator(
                'button[name="SaveEdit"]:visible, button[name="Save"]:visible, button:text-is("Save"):visible'
            )
            .last();
        await saveButton.waitFor({ state: 'visible', timeout: 15000 });
        await saveButton.click();
        await this.waitForLightningSpinnerToDisappear();

        const successToast = this.page
            .locator('.slds-notify__content, .toastMessage, .forceToastMessage')
            .first();
        await successToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
    }

    protected formatDateForUi(isoDate: string): string {
        const [year, month, day] = isoDate.split('-');
        return year && month && day ? `${month}/${day}/${year}` : isoDate;
    }

    /**
     * Create a record through the Lightning "New" page. Field values are applied
     * through the defaultFieldValues URL parameter, then saved through the UI.
     */
    async createRecord(objectApiName: string, fields: object): Promise<string> {
        const defaults = Object.entries(fields)
            .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
            .map(([field, value]) => `${field}=${value}`)
            .join(',');

        const query = defaults ? `?defaultFieldValues=${encodeURIComponent(defaults)}` : '';
        await this.page.goto(`/lightning/o/${objectApiName}/new${query}`);
        await this.waitForLightningSpinnerToDisappear();

        // Some orgs show a record-type selection step before the form.
        const recordTypeNext = this.page
            .locator('.slds-modal button:has-text("Next"), button:has-text("Next")')
            .first();
        if (await recordTypeNext.isVisible({ timeout: 3000 }).catch(() => false)) {
            await recordTypeNext.click();
            await this.waitForLightningSpinnerToDisappear();
        }

        await this.clickPrimarySave();
        return this.extractRecordIdFromUrl(objectApiName);
    }

    /**
     * Update an existing record through the Lightning edit page.
     */
    async editRecord(objectApiName: string, recordId: string, fields: object): Promise<void> {
        await this.page.goto(`/lightning/r/${objectApiName}/${recordId}/edit`);
        await this.waitForLightningSpinnerToDisappear();

        const saveButton = this.primarySaveButton();
        await saveButton.waitFor({ state: 'visible', timeout: 30000 });

        for (const [field, value] of Object.entries(fields)) {
            if (value === undefined || value === null) {
                continue;
            }
            await this.setFieldValue(field, value);
        }

        await this.clickPrimarySave();
        await this.waitForEditConfirmation();
    }

    /**
     * Delete a record through the Lightning record page action menu.
     */
    async deleteRecord(objectApiName: string, recordId: string): Promise<void> {
        await this.navigateToRecord(objectApiName, recordId);
        await this.chooseActionFromMenu('Delete');

        const confirmDelete = this.page
            .locator('.slds-modal button:has-text("Delete"), .slds-modal button[name="Delete"]')
            .last();
        await confirmDelete.waitFor({ state: 'visible', timeout: 15000 });
        await confirmDelete.click();
        await this.waitForLightningSpinnerToDisappear();
    }

    private primarySaveButton() {
        return this.page
            .locator(
                'button[name="SaveEdit"]:visible, button[name="Save"]:visible, button:text-is("Save"):visible'
            )
            .last();
    }

    private async clickPrimarySave(): Promise<void> {
        const saveButton = this.primarySaveButton();
        await saveButton.waitFor({ state: 'visible', timeout: 30000 });
        await saveButton.click();
        await this.waitForLightningSpinnerToDisappear();
    }

    private async waitForEditConfirmation(): Promise<void> {
        // The direct edit page can navigate to Home after saving, and modal edits
        // stay on the record page. In both cases a toast confirms the outcome.
        const errorSelector =
            '.slds-has-error .slds-form-element__help, .forceFormPageError, .slds-notify--toast.slds-theme--error .slds-notify__content';
        const successSelector = '.slds-notify__content, .toastMessage, .forceToastMessage';

        const outcome = await Promise.race([
            this.page
                .locator(errorSelector)
                .first()
                .waitFor({ state: 'visible', timeout: 30000 })
                .then(() => 'error' as const)
                .catch(() => 'timeout' as const),
            this.page
                .locator(successSelector)
                .first()
                .waitFor({ state: 'visible', timeout: 30000 })
                .then(() => 'success' as const)
                .catch(() => 'timeout' as const)
        ]);

        if (outcome === 'error') {
            throw new Error(`The UI save failed: ${await this.readFormError()}`);
        }

        if (outcome === 'timeout') {
            throw new Error(
                `The UI save did not confirm. Current URL: ${this.page.url()}. ${await this.readFormError()}`
            );
        }

        await this.waitForLightningSpinnerToDisappear();
    }

    private async extractRecordIdFromUrl(objectApiName: string): Promise<string> {
        const pattern = new RegExp(
            '/lightning/r/(?:[A-Za-z0-9_]+/)?([a-zA-Z0-9]{15,18})/view'
        );
        const url = await this.waitForSaveResult(pattern);
        const match = url.match(pattern);

        if (!match) {
            throw new Error(`Could not read the ${objectApiName} record ID from ${url}.`);
        }

        return match[1];
    }

    private async waitForSaveResult(urlPattern: RegExp): Promise<string> {
        // Navigation can finish while we are waiting for the spinner, so check the
        // current URL before waiting for a future navigation event.
        if (urlPattern.test(this.page.url())) {
            return this.page.url();
        }

        const errorSelector =
            '.slds-has-error .slds-form-element__help, .forceFormPageError, .slds-notify--toast.slds-theme--error .slds-notify__content';

        const outcome = await Promise.race([
            this.page
                .waitForURL(urlPattern, { timeout: 30000 })
                .then(() => 'saved' as const)
                .catch(() => 'timeout' as const),
            this.page
                .locator(errorSelector)
                .first()
                .waitFor({ state: 'visible', timeout: 30000 })
                .then(() => 'error' as const)
                .catch(() => 'timeout' as const)
        ]);

        if (outcome === 'error') {
            throw new Error(`The UI save failed: ${await this.readFormError()}`);
        }

        if (outcome === 'timeout') {
            throw new Error(
                `The UI save did not complete. Current URL: ${this.page.url()}. ${await this.readFormError()}`
            );
        }

        return this.page.url();
    }

    private async readFormError(): Promise<string> {
        const error = this.page
            .locator(
                '.slds-has-error .slds-form-element__help, .forceFormPageError, .slds-notify--toast.slds-theme--error .slds-notify__content'
            )
            .first();
        const text = await error.textContent().catch(() => null);
        return text ? text.trim() : 'No form error message was shown.';
    }

    private async setFieldValue(fieldName: string, value: unknown): Promise<void> {
        const rawValue = String(value);
        const stringValue =
            DATE_FIELDS.has(fieldName) && /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
                ? this.formatDateForUi(rawValue)
                : rawValue;
        const label = FIELD_LABELS[fieldName] ?? fieldName;

        const textInput = this.page
            .locator(`input[name="${fieldName}"]:visible, textarea[name="${fieldName}"]:visible`)
            .first();
        if (await textInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await textInput.click();
            await textInput.press('Control+A');
            await textInput.press('Backspace');
            await textInput.fill(stringValue);
            return;
        }

        const comboButton = this.page
            .locator(
                `button[name="${fieldName}"]:visible, [role="combobox"][aria-label="${label}"]:visible, lightning-combobox[name="${fieldName}"] button:visible`
            )
            .first();
        if (await comboButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await comboButton.click();
            const option = this.page
                .locator(
                    `lightning-base-combobox-item[data-value="${stringValue}"]:visible, [role="option"]:visible:has-text("${stringValue}")`
                )
                .first();
            await option.waitFor({ state: 'visible', timeout: 10000 });
            await option.click();
            return;
        }

        const lookupInput = this.page.locator(`input[name="${fieldName}"]`).first();
        if (await lookupInput.count()) {
            await lookupInput.click();
            await lookupInput.fill(stringValue);
            const suggestion = this.page
                .locator('[role="option"]:visible, lightning-base-combobox-item:visible')
                .first();
            if (await suggestion.isVisible({ timeout: 5000 }).catch(() => false)) {
                await suggestion.click();
                return;
            }
        }

        throw new Error(`Unable to locate the "${fieldName}" field in the Lightning UI.`);
    }
}
