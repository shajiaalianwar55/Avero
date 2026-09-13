import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceRequestContractSchema } from '@avero/contracts';
import { Discover } from '../apps/provider/src/discover.js';
import { Dispatch, dispatchId } from '../apps/provider/src/dispatch.js';
import { Portal, offerDraftId, responseId } from '../apps/provider/src/portal.js';
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

async function seedDispatched(db: ProviderMemoryDatabase) {
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
  const ids = (await new Discover(db).fromContract(contract)).provider_candidates.map((c) => c.provider_id);
  await new Dispatch(db).run(contract.user_id, contract.request_id, { provider_ids: ids });
  return contract;
}

describe('B-03 provider portal and quote submission', () => {
  it('lists open dispatched jobs per provider and accepts an independent unstructured quote', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedDispatched(db);
    const portal = new Portal(db);

    const jobs007 = await portal.jobs('pro_007');
    expect(jobs007).toHaveLength(1);
    expect(jobs007[0]?.dispatch_id).toBe(dispatchId('sr_001', 'pro_007'));
    expect(jobs007[0]?.issue_summary).toContain('Kitchen sink');

    const messy = fixture('fixtures/provider-responses/messy.json') as { raw_response: string };
    const result = await portal.respond(dispatchId('sr_001', 'pro_007'), {
      provider_id: 'pro_007',
      decision: 'accept',
      message: messy.raw_response,
      currency: 'PKR',
    });

    expect(result.response.response_id).toBe(responseId(dispatchId('sr_001', 'pro_007')));
    expect(result.response.raw_response).toBe(messy.raw_response);
    expect(result.offer_draft?.offer_id).toBe(offerDraftId(contract.request_id, 'pro_007'));
    expect(result.offer_draft?.extraction_confidence).toBe(0);
    expect(result.dispatch_status).toBe('responded');
    expect(await portal.jobs('pro_007')).toHaveLength(0);
    expect(await portal.jobs('pro_008')).toHaveLength(1);
  });

  it('lets three providers respond independently to the same request', async () => {
    const db = new ProviderMemoryDatabase();
    await seedDispatched(db);
    const portal = new Portal(db);
    for (const providerId of ['pro_007', 'pro_008', 'pro_009']) {
      await portal.respond(dispatchId('sr_001', providerId), {
        provider_id: providerId,
        decision: 'accept',
        message: `${providerId} can visit this evening`,
        visit_fee: 1500,
        currency: 'PKR',
      });
    }
    expect(db.tables.provider_responses).toHaveLength(3);
    expect(db.tables.offers).toHaveLength(3);
    expect(db.tables.provider_dispatches?.every((row) => row.status === 'responded')).toBe(true);
  });

  it('stores declines without an offer draft and rejects wrong-provider responses', async () => {
    const db = new ProviderMemoryDatabase();
    await seedDispatched(db);
    const portal = new Portal(db);

    const declined = await portal.respond(dispatchId('sr_001', 'pro_009'), {
      provider_id: 'pro_009',
      decision: 'decline',
      message: 'Fully booked today',
      currency: 'PKR',
    });
    expect(declined.offer_draft).toBeNull();
    expect(declined.response.decision).toBe('decline');
    expect(db.tables.offers ?? []).toHaveLength(0);

    await expect(
      portal.respond(dispatchId('sr_001', 'pro_008'), {
        provider_id: 'pro_007',
        decision: 'accept',
        message: 'spoofed',
        currency: 'PKR',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('is idempotent on repeated respond for the same dispatch', async () => {
    const db = new ProviderMemoryDatabase();
    await seedDispatched(db);
    const portal = new Portal(db);
    const id = dispatchId('sr_001', 'pro_007');
    const first = await portal.respond(id, {
      provider_id: 'pro_007',
      decision: 'accept',
      message: '1500 visit',
      currency: 'PKR',
    });
    const second = await portal.respond(id, {
      provider_id: 'pro_007',
      decision: 'accept',
      message: 'changed mind',
      currency: 'PKR',
    });
    expect(second.response.response_id).toBe(first.response.response_id);
    expect(second.response.raw_response).toBe('1500 visit');
    expect(db.tables.provider_responses).toHaveLength(1);
    expect(db.tables.offers).toHaveLength(1);
  });

  it('rejects empty accept payloads that have no quote content', async () => {
    const db = new ProviderMemoryDatabase();
    await seedDispatched(db);
    await expect(
      new Portal(db).respond(dispatchId('sr_001', 'pro_007'), {
        provider_id: 'pro_007',
        decision: 'accept',
        message: '',
        currency: 'PKR',
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
