import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceRequestContractSchema } from '@avero/contracts';
import { Discover } from '../apps/provider/src/discover.js';
import { HttpError, type Row } from '../apps/provider/src/database.js';
import { ProviderMemoryDatabase } from './helpers/provider-memory.js';

const fixture = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'));

const seededProviders: Row[] = [
  {
    id: 'pro_007',
    name: 'Ahmed Plumbing Services',
    categories: ['plumbing'],
    service_area: 'Islamabad',
    rating: 4.8,
    review_count: 127,
    verification_status: 'verified',
  },
  {
    id: 'pro_008',
    name: 'Capital Home Repair',
    categories: ['plumbing', 'electrical'],
    service_area: 'Islamabad',
    rating: 4.6,
    review_count: 89,
    verification_status: 'verified',
  },
  {
    id: 'pro_009',
    name: 'F-10 Plumbing Works',
    categories: ['plumbing'],
    service_area: 'Islamabad',
    rating: 4.5,
    review_count: 54,
    verification_status: 'seeded_demo',
  },
];

async function seedProviders(db: ProviderMemoryDatabase) {
  for (const provider of seededProviders) await db.save('providers', provider);
}

describe('B-01 provider discovery', () => {
  it('returns the three seeded plumbing providers in deterministic order for the canonical request', async () => {
    const db = new ProviderMemoryDatabase();
    await seedProviders(db);
    const contract = ServiceRequestContractSchema.parse(fixture('fixtures/service-requests/valid.json'));
    const result = await new Discover(db).fromContract(contract);

    expect(result.request_id).toBe('sr_001');
    expect(result.service_request_id).toBe('sr_001');
    expect(result.match_criteria).toEqual({
      category: 'plumbing',
      city: 'Islamabad',
      service_area: 'F-10',
      urgency: 'medium',
      preferred_windows: ['today_evening'],
    });
    expect(result.provider_candidates.map((candidate) => candidate.provider_id)).toEqual([
      'pro_007',
      'pro_008',
      'pro_009',
    ]);
    expect(result.provider_candidates.every((candidate) => candidate.contact_channel === null)).toBe(true);
  });

  it('loads an owned service request by id without reshaping the stored contract', async () => {
    const db = new ProviderMemoryDatabase();
    await seedProviders(db);
    const contract = ServiceRequestContractSchema.parse(fixture('fixtures/service-requests/valid.json'));
    await db.save('service_requests', {
      id: contract.request_id,
      user_id: contract.user_id,
      home_id: contract.home_id,
      diagnosis_session_id: contract.diagnosis_session_id,
      payload: contract,
      status: 'open',
    });

    const result = await new Discover(db).run(contract.user_id, { service_request_id: 'sr_001' });
    expect(result.provider_candidates).toHaveLength(3);
    expect(result.match_criteria.category).toBe('plumbing');
  });

  it('returns an empty list for an unmatched category/city instead of inventing providers', async () => {
    const db = new ProviderMemoryDatabase();
    await seedProviders(db);
    const contract = ServiceRequestContractSchema.parse({
      ...fixture('fixtures/service-requests/valid.json') as object,
      category: 'hvac',
      location: { city: 'Karachi', service_area: 'Clifton' },
      request_id: 'sr_nomatch',
    });

    const result = await new Discover(db).fromContract(contract);
    expect(result.provider_candidates).toEqual([]);
  });

  it('matches electrical on the multi-category seeded provider only', async () => {
    const db = new ProviderMemoryDatabase();
    await seedProviders(db);
    const contract = ServiceRequestContractSchema.parse({
      ...fixture('fixtures/service-requests/valid.json') as object,
      category: 'electrical',
      request_id: 'sr_electrical',
    });

    const result = await new Discover(db).fromContract(contract);
    expect(result.provider_candidates.map((candidate) => candidate.provider_id)).toEqual(['pro_008']);
  });

  it('rejects invalid discover input and unauthorized contract ownership', async () => {
    const db = new ProviderMemoryDatabase();
    await seedProviders(db);
    const discover = new Discover(db);

    await expect(discover.run('usr_001', {})).rejects.toBeInstanceOf(Error);
    await expect(discover.run('usr_001', { service_request_id: 'missing' })).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);

    const contract = ServiceRequestContractSchema.parse(fixture('fixtures/service-requests/valid.json'));
    await expect(discover.run('someone-else', contract)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps ordering stable when ratings tie by preferring verified then id', async () => {
    const db = new ProviderMemoryDatabase();
    await db.save('providers', {
      id: 'pro_b',
      name: 'Beta',
      categories: ['plumbing'],
      service_area: 'Islamabad',
      rating: 4.5,
      review_count: 10,
      verification_status: 'seeded_demo',
    });
    await db.save('providers', {
      id: 'pro_a',
      name: 'Alpha',
      categories: ['plumbing'],
      service_area: 'Islamabad',
      rating: 4.5,
      review_count: 10,
      verification_status: 'verified',
    });
    const contract = ServiceRequestContractSchema.parse(fixture('fixtures/service-requests/valid.json'));
    const result = await new Discover(db).fromContract(contract);
    expect(result.provider_candidates.map((candidate) => candidate.provider_id)).toEqual(['pro_a', 'pro_b']);
  });
});
