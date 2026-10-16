import {
  DispatchChannelSchema,
  DispatchInputSchema,
  DispatchResultSchema,
  ProviderDispatchSchema,
  ServiceRequestContractSchema,
  type DispatchChannel,
  type DispatchResult,
  type ProviderDispatch,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';

/** Stable id so retries upsert the same dispatch row (handoff-style). */
export function dispatchId(serviceRequestId: string, providerId: string) {
  return `disp_${serviceRequestId}_${providerId}`;
}

/**
 * Channel adapter seam for B-02. Portal is simulated in-process for the hackathon.
 * Future WhatsApp/SMS adapters would create `sent` then advance to `delivered` asynchronously.
 */
export function initialStatusForChannel(channel: DispatchChannel) {
  return channel === 'portal' ? 'delivered' as const : 'sent' as const;
}

function toDispatch(row: Row): ProviderDispatch {
  return ProviderDispatchSchema.parse({
    dispatch_id: row.id,
    service_request_id: row.service_request_id,
    provider_id: row.provider_id,
    channel: row.channel,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export class Dispatch {
  constructor(readonly db: Database, readonly channel: DispatchChannel = 'portal') {
    DispatchChannelSchema.parse(channel);
  }

  async run(userId: string, serviceRequestId: string, raw: unknown): Promise<DispatchResult> {
    const input = DispatchInputSchema.parse(raw);
    const providerIds = [...new Set(input.provider_ids)];
    if (!providerIds.length) throw new HttpError(400, 'Invalid request fields');

    const requestRow = (await this.db.list('service_requests', { id: serviceRequestId, user_id: userId }))[0];
    if (!requestRow) throw new HttpError(404, 'Record not found');
    const contract = ServiceRequestContractSchema.parse({ ...requestRow.payload, status: requestRow.status });

    for (const providerId of providerIds) {
      const provider = (await this.db.list('providers', { id: providerId }))[0];
      if (!provider) throw new HttpError(400, 'Unknown provider');
    }

    const now = new Date().toISOString();
    const status = initialStatusForChannel(this.channel);
    const dispatches: ProviderDispatch[] = [];

    for (const providerId of providerIds) {
      const id = dispatchId(contract.request_id, providerId);
      const existing = (await this.db.list('provider_dispatches', { id }))[0];
      if (existing) {
        // Idempotent: never rewind responded/expired; leave active portal jobs unchanged.
        dispatches.push(toDispatch(existing));
        continue;
      }

      const row = await this.db.save('provider_dispatches', {
        id,
        service_request_id: contract.request_id,
        provider_id: providerId,
        user_id: userId,
        channel: this.channel,
        status,
        payload: {
          request_id: contract.request_id,
          category: contract.category,
          urgency: contract.urgency,
          issue_summary: contract.issue_summary,
          location: contract.location,
        },
        created_at: now,
        updated_at: now,
      });
      dispatches.push(toDispatch(row));
    }

    dispatches.sort((a, b) => a.provider_id.localeCompare(b.provider_id));
    return DispatchResultSchema.parse({
      service_request_id: contract.request_id,
      channel: this.channel,
      dispatches,
    });
  }

  /** Read model for B-03 provider portal: jobs that are waiting for a response. */
  async portalJobs(providerId: string): Promise<ProviderDispatch[]> {
    const rows = await this.db.list('provider_dispatches', { provider_id: providerId });
    return rows
      .filter((row) => row.status === 'sent' || row.status === 'delivered')
      .map(toDispatch)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** Snapshot of a stored service request contract for portal job detail (no reshaping). */
  async requestContract(serviceRequestId: string): Promise<ServiceRequestContract | null> {
    const row = (await this.db.list('service_requests', { id: serviceRequestId }))[0];
    if (!row) return null;
    return ServiceRequestContractSchema.parse({ ...row.payload, status: row.status });
  }
}
