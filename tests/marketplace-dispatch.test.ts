import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceRequestContractSchema } from '@avero/contracts';
import { Discover } from '../apps/provider/src/discover.js';
import { Dispatch, dispatchId } from '../apps/provider/src/dispatch.js';
import { ProviderMemoryDatabase } from './helpers/provider-memory.js';
import type { Row } from '../apps/provider/src/database.js';

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

async function seedRequest(db: ProviderMemoryDatabase) {
  for (const provider of seededProviders) await db.save('providers', provider);
  const contract = ServiceRequestContractSchema.parse(fixture('fixtures/service-requests/valid.json'));
  await db.save('users', { id: contract.user_id, name: 'Demo Homeowner' });
  await db.save('homes', {
    id: contract.home_id,
    user_id: contract.user_id,
    label: 'F-10 Home',
    city: contract.location.city,
    service_area: contract.location.service_area,
  });
  await db.save('service_requests', {
    id: contract.request_id,
    user_id: contract.user_id,
    home_id: contract.home_id,
    diagnosis_session_id: contract.diagnosis_session_id,
    payload: contract,
    status: 'open',
  });
  return contract;
}

describe('B-02 request distribution', () => {
  it('dispatches the canonical plumbing request to the three B-01 providers as portal-delivered jobs', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    const discovered = await new Discover(db).fromContract(contract);
    const providerIds = discovered.provider_candidates.map((c) => c.provider_id);
    expect(providerIds).toEqual(['pro_007', 'pro_008', 'pro_009']);

    const result = await new Dispatch(db).run(contract.user_id, contract.request_id, {
      provider_ids: providerIds,
    });

    expect(result.service_request_id).toBe('sr_001');
    expect(result.channel).toBe('portal');
    expect(result.dispatches.map((d) => d.provider_id)).toEqual(['pro_007', 'pro_008', 'pro_009']);
    expect(result.dispatches.every((d) => d.status === 'delivered')).toBe(true);
    expect(result.dispatches.map((d) => d.dispatch_id)).toEqual([
      dispatchId('sr_001', 'pro_007'),
      dispatchId('sr_001', 'pro_008'),
      dispatchId('sr_001', 'pro_009'),
    ]);

    for (const providerId of providerIds) {
      const jobs = await new Dispatch(db).portalJobs(providerId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.service_request_id).toBe('sr_001');
    }
  });

  it('is idempotent on repeated dispatch and does not rewind responded jobs', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    const dispatch = new Dispatch(db);
    const first = await dispatch.run(contract.user_id, 'sr_001', {
      provider_ids: ['pro_007', 'pro_008'],
    });
    const second = await dispatch.run(contract.user_id, 'sr_001', {
      provider_ids: ['pro_008', 'pro_007'],
    });
    expect(second.dispatches).toEqual(first.dispatches);
    expect(db.tables.provider_dispatches).toHaveLength(2);

    const row = db.tables.provider_dispatches!.find((item) => item.provider_id === 'pro_007')!;
    row.status = 'responded';
    row.updated_at = new Date().toISOString();
    const third = await dispatch.run(contract.user_id, 'sr_001', { provider_ids: ['pro_007'] });
    expect(third.dispatches[0]?.status).toBe('responded');
  });

  it('rejects empty or invalid provider selection and unknown providers', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    const dispatch = new Dispatch(db);

    await expect(dispatch.run(contract.user_id, 'sr_001', { provider_ids: [] })).rejects.toBeInstanceOf(Error);
    await expect(dispatch.run(contract.user_id, 'sr_001', {})).rejects.toBeInstanceOf(Error);
    await expect(
      dispatch.run(contract.user_id, 'sr_001', { provider_ids: ['pro_missing'] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects dispatch for a service request the caller does not own', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    await expect(
      new Dispatch(db).run('someone-else', contract.request_id, { provider_ids: ['pro_007'] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('adds only new providers when expanding a prior dispatch set', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    const dispatch = new Dispatch(db);
    await dispatch.run(contract.user_id, 'sr_001', { provider_ids: ['pro_007'] });
    const expanded = await dispatch.run(contract.user_id, 'sr_001', {
      provider_ids: ['pro_007', 'pro_009'],
    });
    expect(expanded.dispatches.map((d) => d.provider_id)).toEqual(['pro_007', 'pro_009']);
    expect(db.tables.provider_dispatches).toHaveLength(2);
  });
});
