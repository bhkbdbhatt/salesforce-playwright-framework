export interface AccountData {
    Name: string;
    Rating?: string;
    Industry?: string;
    Phone?: string;
    Type?: string;
    ParentId?: string;
}

export interface ContactData {
    FirstName: string;
    LastName: string;
    Email: string;
    AccountId: string;
    Title?: string;
}

export interface OpportunityData {
    Name: string;
    StageName: string;
    Amount: number;
    CloseDate: string;
    AccountId: string;
}

export interface LeadData {
    FirstName: string;
    LastName: string;
    Company: string;
    Status: string;
    LeadSource: string;
    Industry: string;
    Rating: string;
    Country: string;
}

/**
 * Generates unique, execution-scoped test data.
 *
 * Demo link to the PDF: backs the "dynamically generate" steps —
 * Scenario 1 step 2, Scenario 2 steps 2/4/5, Scenario 3 step 2,
 * Scenario 4 steps 2-5 and Scenario 5 step 3. The static counter plus a
 * timestamp suffix guarantees no collisions between the 5 consecutive runs.
 */
export class TestDataGenerator {
    private static counter = 0;

    private static uniqueSuffix(): string {
        this.counter += 1;
        return `${Date.now()}_${this.counter}`;
    }

    private static futureDate(daysFromNow: number): string {
        const date = new Date();
        date.setDate(date.getDate() + daysFromNow);
        return date.toISOString().split('T')[0];
    }

    static generateAccountData(): AccountData {
        const suffix = this.uniqueSuffix();
        return {
            Name: `AutoAccount_${suffix}`,
            Rating: 'Hot',
            Industry: 'Technology',
            Phone: '9876543210',
            Type: 'Prospect'
        };
    }

    static generateContactData(accountId: string): ContactData {
        const suffix = this.uniqueSuffix();
        return {
            FirstName: 'Auto',
            LastName: `User_${suffix}`,
            Email: `auto.user_${suffix}@test.com`,
            AccountId: accountId
        };
    }

    static generateOpportunityData(accountId: string, closeDateOffsetDays = 30): OpportunityData {
        const suffix = this.uniqueSuffix();
        return {
            Name: `AutoOpp_${suffix}`,
            StageName: 'Prospecting',
            Amount: Math.floor(Math.random() * 75000) + 10000,
            CloseDate: this.futureDate(closeDateOffsetDays),
            AccountId: accountId
        };
    }

    static generateLeadData(index: number): LeadData {
        const suffix = this.uniqueSuffix();
        const sources = ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'];
        const industries = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing'];
        const ratings = ['Hot', 'Warm', 'Cold'];
        const countries = ['India', 'United States', 'United Kingdom', 'Germany', 'Canada'];

        return {
            FirstName: `Lead${index + 1}`,
            LastName: `Tester_${suffix}`,
            Company: `AutoLead_${suffix}`,
            Status: 'Open - Not Contacted',
            LeadSource: sources[index % sources.length],
            Industry: industries[index % industries.length],
            Rating: ratings[index % ratings.length],
            Country: countries[index % countries.length]
        };
    }
}
