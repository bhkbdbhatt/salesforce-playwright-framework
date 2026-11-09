import { SoqlQueries } from '../api/soqlQueries';

export interface RecordApi {
    deleteRecord(objectApiName: string, recordId: string): Promise<void>;
    queryOne<T = any>(soqlQuery: string): Promise<T>;
}

export interface TrackedRecord {
    type: string;
    id: string;
}

export class CleanupManager {
    private records: TrackedRecord[] = [];

    constructor(private readonly sfApi: RecordApi) {}

    track(type: string, id?: string | null): void {
        if (!id) {
            return;
        }
        const alreadyTracked = this.records.some(record => record.type === type && record.id === id);
        if (!alreadyTracked) {
            this.records.push({ type, id });
        }
    }

    untrack(type: string, id?: string | null): void {
        if (!id) {
            return;
        }
        this.records = this.records.filter(record => !(record.type === type && record.id === id));
    }

    get trackedRecords(): TrackedRecord[] {
        return [...this.records];
    }

    async cleanup(): Promise<string[]> {
        const errors: string[] = [];

        for (const record of [...this.records].reverse()) {
            try {
                await this.sfApi.deleteRecord(record.type, record.id);
            } catch (error) {
                errors.push(
                    `${record.type} ${record.id}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (errors.length > 0) {
            console.warn(`Cleanup completed with ${errors.length} issue(s):`);
            for (const message of errors) {
                console.warn(` - ${message}`);
            }
        }

        return errors;
    }
}

/**
 * Converted Leads cannot be deleted. Before cleanup, expand any Lead that was
 * converted mid-run into the Account/Contact/Opportunity records it produced so
 * that those records are cleaned up instead of being orphaned.
 */
export async function reconcileTrackedLeads(
    sfApi: RecordApi,
    cleanup: CleanupManager
): Promise<void> {
    const trackedLeads = cleanup.trackedRecords.filter(record => record.type === 'Lead');

    for (const lead of trackedLeads) {
        try {
            const leadRecord = await sfApi.queryOne<any>(SoqlQueries.getLeadStatus(lead.id));
            if (leadRecord.IsConverted) {
                cleanup.untrack('Lead', lead.id);
                cleanup.track('Account', leadRecord.ConvertedAccountId);
                cleanup.track('Contact', leadRecord.ConvertedContactId);
                cleanup.track('Opportunity', leadRecord.ConvertedOpportunityId);
            }
        } catch {
            // Leave the Lead tracked; cleanup will attempt the delete and report any issue.
        }
    }
}
