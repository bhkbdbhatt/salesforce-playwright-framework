export type ExecutionMode = 'api' | 'ui';

/**
 * Default execution mode for every Salesforce data operation.
 *
 * - 'api' -> create, update, convert and delete records through the REST/SOAP APIs.
 * - 'ui'  -> perform the same operations through the Salesforce Lightning UI.
 *
 * Read-only verification (SOQL queries and REST GET) always runs through the API,
 * because SOQL has no UI equivalent.
 */
export const EXECUTION_MODE: ExecutionMode = 'api';

/**
 * Optional environment override, useful for CI runs.
 * Set SF_EXECUTION_MODE=ui or SF_EXECUTION_MODE=api to override the file value.
 */
export function resolveExecutionMode(): ExecutionMode {
    const override = (process.env.SF_EXECUTION_MODE || '').trim().toLowerCase();

    if (override === 'api' || override === 'ui') {
        return override;
    }

    return EXECUTION_MODE;
}
