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
