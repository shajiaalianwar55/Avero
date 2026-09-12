import {
  NormalizedOfferContractSchema,
  ProviderJobSchema,
  ProviderRespondInputSchema,
  ProviderRespondResultSchema,
  RawProviderResponseSchema,
  type ProviderJob,
  type ProviderRespondResult,
  type RawProviderResponse,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';
import { Dispatch } from './dispatch.js';

export function responseId(dispatchId: string) {
  return `presp_${dispatchId}`;
}

export function offerDraftId(serviceRequestId: string, providerId: string) {
  return `off_${serviceRequestId}_${providerId}`;
}

function composeRaw(input: {
  decision: 'accept' | 'decline';
  message: string;
  visit_fee: number | null;
  estimated_total_min: number | null;
  estimated_total_max: number | null;
  parts_included: boolean | null;
  arrival_window: string | null;
  warranty_days: number | null;
  currency: string;
}) {
  if (input.message.trim()) return input.message.trim();
  if (input.decision === 'decline') return 'Declined';
  const parts: string[] = [];
  if (input.visit_fee != null) parts.push(`${input.visit_fee} ${input.currency} visit`);
  if (input.estimated_total_min != null || input.estimated_total_max != null) {
    parts.push(`estimate ${input.estimated_total_min ?? '?'}-${input.estimated_total_max ?? '?'} ${input.currency}`);
  }
  if (input.arrival_window) parts.push(`arrival ${input.arrival_window}`);
  if (input.parts_included === true) parts.push('parts included');
  if (input.parts_included === false) parts.push('parts separate');
  if (input.warranty_days != null) parts.push(`${input.warranty_days} day warranty`);
  return parts.join(', ') || 'Accepted';
}

export class Portal {
  constructor(readonly db: Database, readonly dispatch = new Dispatch(db)) {}

  async providers() {
    const rows = await this.db.list('providers');
    return rows
      .map((row) => ({
        provider_id: row.id as string,
        name: row.name as string,
        categories: (row.categories ?? []) as string[],
        service_area: row.service_area as string,
        rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
        review_count: Number(row.review_count ?? 0),
        verification_status: row.verification_status as string,
      }))
      .sort((a, b) => a.provider_id.localeCompare(b.provider_id));
  }

  async jobs(providerId: string): Promise<ProviderJob[]> {
    if (!(await this.db.list('providers', { id: providerId }))[0]) throw new HttpError(400, 'Unknown provider');
    const open = await this.dispatch.portalJobs(providerId);
    const jobs: ProviderJob[] = [];
    for (const item of open) {
      const payload = ((await this.db.list('provider_dispatches', { id: item.dispatch_id }))[0]?.payload ?? {}) as Record<string, unknown>;
      const location = (payload.location ?? { city: 'Unknown', service_area: 'Unknown' }) as {
        city: string;
        service_area: string;
      };
      jobs.push(ProviderJobSchema.parse({
        dispatch_id: item.dispatch_id,
        service_request_id: item.service_request_id,
        provider_id: item.provider_id,
        status: item.status,
        channel: item.channel,
        created_at: item.created_at,
        issue_summary: String(payload.issue_summary ?? 'Service request'),
        category: String(payload.category ?? 'general'),
        urgency: (payload.urgency as 'low' | 'medium' | 'high' | 'immediate') ?? 'medium',
        location: { city: String(location.city), service_area: String(location.service_area) },
      }));
    }
    return jobs;
  }

  async respond(dispatchId: string, raw: unknown): Promise<ProviderRespondResult> {
    const input = ProviderRespondInputSchema.parse(raw);
    const row = (await this.db.list('provider_dispatches', { id: dispatchId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    if (row.provider_id !== input.provider_id) throw new HttpError(403, 'Provider does not own this job');

    const existingResponse = (await this.db.list('provider_responses', { dispatch_id: dispatchId }))[0];
    if (existingResponse || row.status === 'responded') {
      return this.existingResult(dispatchId, row, existingResponse);
    }
    if (row.status !== 'sent' && row.status !== 'delivered') {
      throw new HttpError(409, 'This job is no longer open for responses');
    }

    const now = new Date().toISOString();
    const raw_response = composeRaw({
      decision: input.decision,
      message: input.message,
      visit_fee: input.visit_fee ?? null,
      estimated_total_min: input.estimated_total_min ?? null,
      estimated_total_max: input.estimated_total_max ?? null,
      parts_included: input.parts_included ?? null,
      arrival_window: input.arrival_window ?? null,
      warranty_days: input.warranty_days ?? null,
      currency: input.currency.toUpperCase(),
    });

    const responsePayload = {
      decision: input.decision,
      message: input.message,
      visit_fee: input.visit_fee ?? null,
      estimated_total_min: input.estimated_total_min ?? null,
      estimated_total_max: input.estimated_total_max ?? null,
      parts_included: input.parts_included ?? null,
      arrival_window: input.arrival_window ?? null,
      warranty_days: input.warranty_days ?? null,
      currency: input.currency.toUpperCase(),
    };

    const responseRow = await this.db.save('provider_responses', {
      id: responseId(dispatchId),
      dispatch_id: dispatchId,
      service_request_id: row.service_request_id,
      provider_id: input.provider_id,
      decision: input.decision,
      payload: responsePayload,
      raw_response,
      created_at: now,
    });

    let offer_draft: Record<string, unknown> | null = null;
    if (input.decision === 'accept') {
      const draft = NormalizedOfferContractSchema.parse({
        offer_id: offerDraftId(row.service_request_id, input.provider_id),
        service_request_id: row.service_request_id,
        provider_id: input.provider_id,
        visit_fee: input.visit_fee ?? null,
        currency: input.currency.toUpperCase(),
        estimated_total_min: input.estimated_total_min ?? null,
        estimated_total_max: input.estimated_total_max ?? null,
        parts_included: input.parts_included ?? null,
        arrival_window: input.arrival_window ?? null,
        warranty_days: input.warranty_days ?? null,
        raw_response,
        // Draft only — B-04 will normalize unstructured replies and set real confidence.
        extraction_confidence: 0,
      });
      await this.db.save('offers', {
        id: draft.offer_id,
        service_request_id: draft.service_request_id,
        provider_id: draft.provider_id,
        payload: draft,
        raw_response: draft.raw_response,
        created_at: now,
      });
      offer_draft = draft;
    }

    row.status = 'responded';
    row.updated_at = now;
    await this.db.save('provider_dispatches', row);

    const response = RawProviderResponseSchema.parse({
      response_id: responseRow.id,
      dispatch_id: dispatchId,
      service_request_id: row.service_request_id,
      provider_id: input.provider_id,
      decision: input.decision,
      raw_response,
      created_at: responseRow.created_at ?? now,
    });

    return ProviderRespondResultSchema.parse({
      response,
      offer_draft,
      dispatch_status: 'responded',
    });
  }

  private async existingResult(dispatchId: string, dispatchRow: Row, existingResponse?: Row): Promise<ProviderRespondResult> {
    const responseRow = existingResponse
      ?? (await this.db.list('provider_responses', { dispatch_id: dispatchId }))[0];
    if (!responseRow) throw new HttpError(409, 'This job is no longer open for responses');
    const response: RawProviderResponse = RawProviderResponseSchema.parse({
      response_id: responseRow.id,
      dispatch_id: dispatchId,
      service_request_id: responseRow.service_request_id,
      provider_id: responseRow.provider_id,
      decision: responseRow.decision,
      raw_response: responseRow.raw_response,
      created_at: responseRow.created_at,
    });
    let offer_draft: Record<string, unknown> | null = null;
    if (response.decision === 'accept') {
      const offer = (await this.db.list('offers', {
        id: offerDraftId(response.service_request_id, response.provider_id),
      }))[0];
      offer_draft = offer ? (offer.payload as Record<string, unknown>) : null;
    }
    return ProviderRespondResultSchema.parse({
      response,
      offer_draft,
      dispatch_status: dispatchRow.status === 'responded' ? 'responded' : 'responded',
    });
  }
}
