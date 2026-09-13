import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AIEvaluationCaseSchema,
  type AIEvaluationCase,
  type QuoteExtraction,
  ServiceRequestContractSchema,
} from '@avero/contracts';
import { Discover } from '../apps/provider/src/discover.js';
import { Dispatch, dispatchId } from '../apps/provider/src/dispatch.js';
import { Normalize } from '../apps/provider/src/normalize.js';
import { Portal, offerDraftId, responseId } from '../apps/provider/src/portal.js';
import type { Transport } from '../apps/provider/src/ai.js';
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

const evaluations = (fixture('fixtures/ai-evaluations/B-04.json') as unknown[])
  .map((entry) => AIEvaluationCaseSchema.parse(entry));

function evaluation(kind: AIEvaluationCase['kind']) {
  const found = evaluations.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`missing B-04 evaluation kind ${kind}`);
  return found;
}

function extractionTransport(output: QuoteExtraction): Transport {
  return async () => output;
}

async function seedAcceptedOffer(
  db: ProviderMemoryDatabase,
  providerId: string,
  raw_response: string,
) {
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
  const portal = new Portal(db);
  await portal.respond(dispatchId(contract.request_id, providerId), {
    provider_id: providerId,
    decision: 'accept',
    message: raw_response,
  });
  return contract;
}

describe('B-04 AI quote normalization', () => {
  it('normal: informal response becomes a comparable offer without losing raw text', async () => {
    const caseNormal = evaluation('normal');
    const raw = String(caseNormal.input.raw_response);
    const db = new ProviderMemoryDatabase();
    const contract = await seedAcceptedOffer(db, 'pro_007', raw);
    const offerId = offerDraftId(contract.request_id, 'pro_007');

    const transport = extractionTransport({
      visit_fee: 1500,
      currency: 'PKR',
      estimated_total_min: null,
      estimated_total_max: null,
      parts_included: false,
      arrival_window: '19:00',
      warranty_days: 7,
      confidence: 0.94,
      missing_fields: ['estimated_total_min', 'estimated_total_max'],
      warnings: [],
      abstain: false,
    });

    const result = await new Normalize(db).withTransport(transport).run(contract.user_id, offerId);

    expect(result.execution_state).toBe(caseNormal.assertions.execution_state);
    expect(result.offer.visit_fee).toBe(caseNormal.expected_output.visit_fee);
    expect(result.offer.currency).toBe(caseNormal.expected_output.currency);
    expect(result.offer.parts_included).toBe(caseNormal.expected_output.parts_included);
    expect(result.offer.warranty_days).toBe(caseNormal.expected_output.warranty_days);
    expect(result.offer.raw_response).toBe(raw);
    expect(result.offer.extraction_confidence).toBeGreaterThan(0);

    const stored = (await db.list('offers', { id: offerId }))[0];
    expect(stored?.raw_response).toBe(raw);
    expect(stored?.payload.extraction_confidence).toBe(result.offer.extraction_confidence);

    const events = db.tables.ai_events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.feature_id).toBe('B-04');
    expect(events[0]?.input_record_id).toBe(responseId(dispatchId(contract.request_id, 'pro_007')));
    expect(events[0]?.output_record_id).toBe(offerId);
    expect(events[0]?.execution_state).toBe('success');
    expect(events[0]?.validation_passed).toBe(true);
  });

  it('difficult: mixed Urdu/English keeps unknown parts inclusion and caps confidence', async () => {
    const caseDifficult = evaluation('difficult');
    const raw = String(caseDifficult.input.raw_response);
    const db = new ProviderMemoryDatabase();
    const contract = await seedAcceptedOffer(db, 'pro_008', raw);
    const offerId = offerDraftId(contract.request_id, 'pro_008');

    const transport = extractionTransport({
      visit_fee: 2000,
      currency: 'PKR',
      estimated_total_min: null,
      estimated_total_max: null,
      parts_included: null,
      arrival_window: '19:00',
      warranty_days: null,
      confidence: 0.72,
      missing_fields: ['estimated_total_min', 'estimated_total_max', 'parts_included', 'warranty_days'],
      warnings: ['parts inclusion unknown'],
      abstain: false,
    });

    const result = await new Normalize(db).withTransport(transport).run(contract.user_id, offerId);

    expect(result.execution_state).toBe(caseDifficult.assertions.execution_state);
    expect(result.offer.visit_fee).toBe(caseDifficult.expected_output.visit_fee);
    expect(result.offer.currency).toBe(caseDifficult.expected_output.currency);
    expect(result.offer.arrival_window).toBe(caseDifficult.expected_output.arrival_window);
    expect(result.offer.parts_included).toBeNull();
    expect(result.normalization_warnings).toEqual(expect.arrayContaining(['parts inclusion unknown']));
    expect(result.offer.extraction_confidence).toBeLessThanOrEqual(caseDifficult.assertions.confidence_at_most!);
    expect(result.offer.raw_response).toBe(raw);
    expect(result.missing_fields).toContain('parts_included');
  });

  it('safe_failure: content-free reply abstains and leaves money fields unknown', async () => {
    const caseSafe = evaluation('safe_failure');
    const raw = String(caseSafe.input.raw_response);
    const db = new ProviderMemoryDatabase();
    const contract = await seedAcceptedOffer(db, 'pro_009', raw);
    const offerId = offerDraftId(contract.request_id, 'pro_009');

    const transport = extractionTransport({
      visit_fee: null,
      currency: 'PKR',
      estimated_total_min: null,
      estimated_total_max: null,
      parts_included: null,
      arrival_window: null,
      warranty_days: null,
      confidence: 0.1,
      missing_fields: [
        'visit_fee',
        'estimated_total_min',
        'estimated_total_max',
        'parts_included',
        'arrival_window',
        'warranty_days',
      ],
      warnings: ['insufficient pricing information'],
      abstain: true,
    });

    const result = await new Normalize(db).withTransport(transport).run(contract.user_id, offerId);

    expect(result.execution_state).toBe(caseSafe.assertions.execution_state);
    expect(result.offer.visit_fee).toBeNull();
    expect(result.offer.estimated_total_min).toBeNull();
    expect(result.offer.estimated_total_max).toBeNull();
    expect(result.normalization_warnings).toEqual(
      expect.arrayContaining(caseSafe.expected_output.warnings as string[]),
    );
    expect(result.offer.extraction_confidence).toBeLessThanOrEqual(caseSafe.assertions.confidence_at_most!);
    expect(result.offer.raw_response).toBe(raw);

    const event = db.tables.ai_events?.[0];
    expect(event?.execution_state).toBe('abstained');
    expect(event?.fallback_reason).toBeTruthy();
  });

  it('rejects normalize for a service request the caller does not own', async () => {
    const db = new ProviderMemoryDatabase();
    const messy = fixture('fixtures/provider-responses/messy.json') as { raw_response: string };
    const contract = await seedAcceptedOffer(db, 'pro_007', messy.raw_response);
    await expect(
      new Normalize(db).withTransport(extractionTransport({
        visit_fee: 1500,
        currency: 'PKR',
        estimated_total_min: null,
        estimated_total_max: null,
        parts_included: false,
        arrival_window: null,
        warranty_days: 7,
        confidence: 0.9,
        missing_fields: [],
        warnings: [],
        abstain: false,
      })).run('someone-else', offerDraftId(contract.request_id, 'pro_007')),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('falls back conservatively when the model transport is unavailable', async () => {
    const db = new ProviderMemoryDatabase();
    const messy = fixture('fixtures/provider-responses/messy.json') as { raw_response: string };
    const contract = await seedAcceptedOffer(db, 'pro_007', messy.raw_response);
    const failing: Transport = async () => {
      throw new Error('provider_unconfigured');
    };

    const result = await new Normalize(db).withTransport(failing).run(
      contract.user_id,
      offerDraftId(contract.request_id, 'pro_007'),
    );

    expect(result.execution_state).toBe('fallback');
    expect(result.offer.visit_fee).toBeNull();
    expect(result.offer.estimated_total_min).toBeNull();
    expect(result.offer.raw_response).toBe(messy.raw_response);
    expect(result.normalization_warnings).toContain('insufficient pricing information');
    expect(db.tables.ai_events?.[0]?.execution_state).toBe('fallback');
  });
});
