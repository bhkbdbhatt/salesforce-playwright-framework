/**
 * Reusable SOQL builders for the relationship-validation steps.
 *
 * Demo link to the PDF:
 * - getFullSalesLifecycle -> Scenario 1 step 9, Scenario 2 step 9,
 *   Scenario 5 step 13 (Account with Contacts + Opportunities).
 * - getAccountHierarchy   -> Scenario 4 step 9 (Parent -> Child accounts).
 * - getLeadStatus         -> Scenario 3 steps 8/10 and Scenario 5 step 8
 *   (IsConverted + ConvertedAccountId/ContactId/OpportunityId).
 * - getOpportunityByName  -> helper for Opportunity lookups.
 */
export class SoqlQueries {
    private static escape(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    static getAccountHierarchy(parentId: string): string {
        const id = this.escape(parentId);
        return `SELECT Id, Name, (SELECT Id, Name, ParentId FROM ChildAccounts), (SELECT Id FROM Contacts), (SELECT Id FROM Opportunities) FROM Account WHERE Id = '${id}'`;
    }

    static getLeadStatus(leadId: string): string {
        const id = this.escape(leadId);
        return `SELECT Id, IsConverted, Status, ConvertedAccountId, ConvertedContactId, ConvertedOpportunityId FROM Lead WHERE Id = '${id}'`;
    }

    static getFullSalesLifecycle(accountId: string): string {
        const id = this.escape(accountId);
        return `SELECT Id, Name, (SELECT Id, FirstName, LastName, Email, Title FROM Contacts), (SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunities) FROM Account WHERE Id = '${id}'`;
    }

    static getOpportunityByName(accountId: string, name: string): string {
        return `SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunity WHERE AccountId = '${this.escape(accountId)}' AND Name = '${this.escape(name)}'`;
    }
}
