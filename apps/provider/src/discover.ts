import {
  DiscoverByRequestIdSchema,
  DiscoverResultSchema,
  ProviderCandidateSchema,
  ServiceRequestContractSchema,
  type DiscoverResult,
  type ProviderCandidate,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';

const norm = (value: string) => value.trim().toLowerCase();

function toCandidate(row: Row): ProviderCandidate {
  return ProviderCandidateSchema.parse({
    provider_id: row.id,
    name: row.name,
    categories: row.categories ?? [],
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    review_count: Number(row.review_count ?? 0),
    service_area: row.service_area,
    contact_channel: null,
    verification_status: row.verification_status,
  });
}

function matches(row: Row, request: ServiceRequestContract): boolean {
  const categories: string[] = Array.isArray(row.categories) ? row.categories : [];
  const categoryOk = categories.some((entry) => norm(String(entry)) === norm(request.category));
  if (!categoryOk) return false;
  const area = norm(String(row.service_area ?? ''));
  // Seeded providers store city-scale areas (e.g. Islamabad) while requests carry city + neighborhood.
  return area === norm(request.location.city) || area === norm(request.location.service_area);
}

function compareCandidates(a: ProviderCandidate, b: ProviderCandidate): number {
  const ratingA = a.rating ?? -1;
  const ratingB = b.rating ?? -1;
  if (ratingB !== ratingA) return ratingB - ratingA;
  if (b.review_count !== a.review_count) return b.review_count - a.review_count;
  const verified = (status: string) => (status === 'verified' ? 0 : 1);
  const verification = verified(a.verification_status) - verified(b.verification_status);
  if (verification !== 0) return verification;
  return a.provider_id.localeCompare(b.provider_id);
}

export class Discover {
  constructor(readonly db: Database) {}

  async run(userId: string, raw: unknown): Promise<DiscoverResult> {
    const byId = DiscoverByRequestIdSchema.safeParse(raw);
    if (byId.success) return this.fromRequestId(userId, byId.data.service_request_id);

    const contract = ServiceRequestContractSchema.parse(raw);
    if (contract.user_id !== userId) throw new HttpError(404, 'Record not found');
    return this.fromContract(contract);
  }

  async fromRequestId(userId: string, serviceRequestId: string): Promise<DiscoverResult> {
    const row = (await this.db.list('service_requests', { id: serviceRequestId, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    const contract = ServiceRequestContractSchema.parse({ ...row.payload, status: row.status });
    return this.fromContract(contract);
  }

  async fromContract(request: ServiceRequestContract): Promise<DiscoverResult> {
    const providers = await this.db.list('providers');
    const provider_candidates = providers
      .filter((row) => matches(row, request))
      .map(toCandidate)
      .sort(compareCandidates);

    return DiscoverResultSchema.parse({
      service_request_id: request.request_id,
      request_id: request.request_id,
      match_criteria: {
        category: request.category,
        city: request.location.city,
        service_area: request.location.service_area,
        urgency: request.urgency,
        preferred_windows: request.preferred_windows,
      },
      provider_candidates,
    });
  }
}
