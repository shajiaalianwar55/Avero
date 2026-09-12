import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AIEvaluationCaseSchema,
  NormalizedOfferContractSchema,
  type AIEvaluationCase,
  type NormalizedOfferContract,
  type RankingExplanation,
  ServiceRequestContractSchema,
} from '@avero/contracts';
import type { Transport } from '../apps/provider/src/ai.js';
import type { Row } from '../apps/provider/src/database.js';
import { Ranking, rankCandidates, rankingId, scoreWeights } from '../apps/provider/src/ranking.js';
import { ProviderMemoryDatabase } from './helpers/provider-memory.js';

const fixture = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'));

const evaluations = (fixture('fixtures/ai-evaluations/B-05.json') as unknown[])
  .map((entry) => AIEvaluationCaseSchema.parse(entry));

function evaluation(kind: AIEvaluationCase['kind']) {
  const found = evaluations.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`missing B-05 evaluation kind ${kind}`);
  return found;
}

const providers: Record<string, Row> = {
  pro_007: {
    id: 'pro_007',
    name: 'Ahmed Plumbing Services',
    categories: ['plumbing'],
    service_area: 'Islamabad',
    rating: 4.8,
    review_count: 127,
    verification_status: 'verified',
  },
  pro_008: {
    id: 'pro_008',
    name: 'Capital Home Repair',
    categories: ['plumbing', 'electrical'],
    service_area: 'Islamabad',
    rating: 4.6,
    review_count: 89,
    verification_status: 'verified',
  },
  pro_009: {
    id: 'pro_009',
    name: 'F-10 Plumbing Works',
    categories: ['plumbing'],
    service_area: 'Islamabad',
    rating: 4.5,
    review_count: 54,
    verification_status: 'seeded_demo',
  },
};

function offer(partial: Partial<NormalizedOfferContract> & Pick<NormalizedOfferContract, 'offer_id' | 'provider_id'>): NormalizedOfferContract {
  return NormalizedOfferContractSchema.parse({
    service_request_id: 'sr_001',
    visit_fee: null,
    currency: 'PKR',
    estimated_total_min: null,
    estimated_total_max: null,
    parts_included: null,
    arrival_window: null,
    warranty_days: null,
    raw_response: 'quote',
    extraction_confidence: 0.9,
    ...partial,
  });
}

function explainTransport(output: RankingExplanation): Transport {
  return async () => output;
}

async function seedRequest(db: ProviderMemoryDatabase, urgency: 'low' | 'medium' | 'high' | 'immediate' = 'medium') {
  const contract = ServiceRequestContractSchema.parse({
    ...fixture('fixtures/service-requests/valid.json') as object,
    urgency,
  });
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
  for (const provider of Object.values(providers)) await db.save('providers', provider);
  return contract;
}

async function saveOffer(db: ProviderMemoryDatabase, value: NormalizedOfferContract) {
  await db.save('offers', {
    id: value.offer_id,
    service_request_id: value.service_request_id,
    provider_id: value.provider_id,
    payload: value,
    raw_response: value.raw_response,
    created_at: new Date().toISOString(),
  });
}

describe('B-05 offer ranking', () => {
  it('normal: balanced scores recommend the best overall fit with breakdowns', async () => {
    const caseNormal = evaluation('normal');
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db, 'medium');

    // off_101 strongest overall (seeded fixture shape); siblings weaker on rating/warranty/price mix.
    await saveOffer(db, offer({
      offer_id: 'off_101',
      provider_id: 'pro_007',
      visit_fee: 1500,
      estimated_total_min: 1500,
      estimated_total_max: 3500,
      arrival_window: '19:00-20:00',
      warranty_days: 7,
      parts_included: false,
      raw_response: '1500 visit, can come 7ish, parts separate, 7 day service warranty',
      extraction_confidence: 0.94,
    }));
    await saveOffer(db, offer({
      offer_id: 'off_102',
      provider_id: 'pro_008',
      visit_fee: 1800,
      arrival_window: '20:00-21:00',
      warranty_days: 3,
      extraction_confidence: 0.9,
    }));
    await saveOffer(db, offer({
      offer_id: 'off_103',
      provider_id: 'pro_009',
      visit_fee: 2200,
      arrival_window: '21:00-22:00',
      warranty_days: 1,
      extraction_confidence: 0.88,
    }));

    const result = await new Ranking(db).withTransport(explainTransport({
      explanation: 'Recommend off_101 for balanced price, availability, rating, and warranty.',
      cited_factors: ['price', 'rating', 'warranty'],
      why_not_cheapest: null,
      confidence: 0.9,
    })).run(contract.user_id, contract.request_id);

    expect(result.execution_state).toBe(caseNormal.assertions.execution_state);
    expect(result.recommended_offer_id).toBe(caseNormal.expected_output.recommended_offer_id);
    expect(result.ranked_offers).toHaveLength(3);
    expect(result.ranked_offers[0]?.score_breakdown).toMatchObject({
      price: expect.any(Number),
      availability: expect.any(Number),
      rating: expect.any(Number),
      warranty: expect.any(Number),
      fit: expect.any(Number),
    });
    expect(result.recommendation_evidence.paid_placement_applied).toBe(false);
    expect(db.tables.offer_rankings?.[0]?.id).toBe(rankingId(contract.request_id));
    expect(db.tables.ai_events?.[0]?.feature_id).toBe('B-05');
  });

  it('difficult: high urgency prefers availability and warranty over the cheapest price', async () => {
    const caseDifficult = evaluation('difficult');
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db, 'high');

    await saveOffer(db, offer({
      offer_id: 'off_cheap_late',
      provider_id: 'pro_009',
      visit_fee: 900,
      arrival_window: '22:00-23:00',
      warranty_days: 0,
      extraction_confidence: 0.9,
      raw_response: '900 only, late night',
    }));
    await saveOffer(db, offer({
      offer_id: 'off_fast_warranty',
      provider_id: 'pro_007',
      visit_fee: 2500,
      arrival_window: '10:00-11:00',
      warranty_days: 14,
      extraction_confidence: 0.92,
      raw_response: '2500, morning, 14 day warranty',
    }));

    const result = await new Ranking(db).withTransport(explainTransport({
      explanation: 'Recommend off_fast_warranty because availability and warranty outweigh the cheaper late offer under high urgency.',
      cited_factors: ['availability', 'warranty'],
      why_not_cheapest: 'off_cheap_late is cheaper but weaker on availability and warranty.',
      confidence: 0.8,
    })).run(contract.user_id, contract.request_id);

    expect(result.recommended_offer_id).toBe(caseDifficult.expected_output.recommended_offer_id);
    expect(result.recommendation_evidence.cheapest_offer_id).toBe('off_cheap_late');
    expect(result.recommended_offer_id).not.toBe(result.recommendation_evidence.cheapest_offer_id);
    const mentions = caseDifficult.expected_output.explanation_mentions as string[];
    for (const word of mentions) {
      expect(result.explanation.toLowerCase()).toContain(word);
    }
    expect(result.execution_state).toBe('success');
    expect(scoreWeights('high').availability).toBeGreaterThan(scoreWeights('high').price);
  });

  it('safe_failure: no normalized offers abstains without a recommendation', async () => {
    const caseSafe = evaluation('safe_failure');
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db, 'medium');

    const result = await new Ranking(db).run(contract.user_id, contract.request_id);

    expect(result.recommended_offer_id).toBeNull();
    expect(result.ranked_offers).toEqual([]);
    expect(result.execution_state).toBe(caseSafe.assertions.execution_state);
    expect(db.tables.ai_events?.[0]?.execution_state).toBe('abstained');
  });

  it('rejects ranking for a service request the caller does not own', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    await expect(new Ranking(db).run('someone-else', contract.request_id)).rejects.toMatchObject({ status: 404 });
  });

  it('excludes unnormalized B-03 drafts and preserves offer raw_response', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    const draft = offer({
      offer_id: 'off_draft',
      provider_id: 'pro_008',
      visit_fee: 1000,
      arrival_window: '12:00-13:00',
      warranty_days: 30,
      extraction_confidence: 0,
      raw_response: 'keep me raw',
    });
    const ready = offer({
      offer_id: 'off_ready',
      provider_id: 'pro_007',
      visit_fee: 1600,
      arrival_window: '18:00-19:00',
      warranty_days: 7,
      extraction_confidence: 0.91,
      raw_response: 'normalized raw',
    });
    await saveOffer(db, draft);
    await saveOffer(db, ready);

    const result = await new Ranking(db).withTransport(explainTransport({
      explanation: 'Only the normalized offer is ranked.',
      cited_factors: ['price'],
      why_not_cheapest: null,
      confidence: 0.7,
    })).run(contract.user_id, contract.request_id);

    expect(result.ranked_offers.map((item) => item.offer_id)).toEqual(['off_ready']);
    expect(result.ranked_offers[0]?.offer.raw_response).toBe('normalized raw');
    expect((await db.list('offers', { id: 'off_draft' }))[0]?.raw_response).toBe('keep me raw');
  });

  it('falls back to a template explanation when the model transport fails', async () => {
    const db = new ProviderMemoryDatabase();
    const contract = await seedRequest(db);
    await saveOffer(db, offer({
      offer_id: 'off_ready',
      provider_id: 'pro_007',
      visit_fee: 1500,
      arrival_window: '19:00-20:00',
      warranty_days: 7,
      extraction_confidence: 0.9,
    }));

    const failing: Transport = async () => {
      throw new Error('provider_unconfigured');
    };
    const result = await new Ranking(db).withTransport(failing).run(contract.user_id, contract.request_id);

    expect(result.execution_state).toBe('fallback');
    expect(result.recommended_offer_id).toBe('off_ready');
    expect(result.explanation.length).toBeGreaterThan(10);
    expect(db.tables.ai_events?.[0]?.execution_state).toBe('fallback');
  });

  it('uses deterministic tie-breaks without paid placement', () => {
    const tied = rankCandidates(
      [
        {
          offer: offer({
            offer_id: 'off_b',
            provider_id: 'pro_009',
            visit_fee: 1500,
            arrival_window: '19:00-20:00',
            warranty_days: 7,
          }),
          provider: { ...providers.pro_009!, rating: 4.8, review_count: 10, verification_status: 'verified' },
        },
        {
          offer: offer({
            offer_id: 'off_a',
            provider_id: 'pro_007',
            visit_fee: 1500,
            arrival_window: '19:00-20:00',
            warranty_days: 7,
          }),
          provider: { ...providers.pro_007!, rating: 4.8, review_count: 10, verification_status: 'verified' },
        },
      ],
      'medium',
      'plumbing',
      ['today_evening'],
    );
    expect(tied[0]?.offer_id).toBe('off_a');
    expect(tied.every((item) => Object.keys(item.score_breakdown).sort().join() === 'availability,fit,price,rating,warranty')).toBe(true);
  });
});
