import {
  NormalizedOfferContractSchema,
  RankedOffersResultSchema,
  RankingExplanationSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
  type RankedOffer,
  type RankedOffersResult,
  type RankingExplanation,
  type ScoreBreakdown,
  type Urgency,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';
import { AI, type Transport } from './ai.js';

export function rankingId(serviceRequestId: string) {
  return `rank_${serviceRequestId}`;
}

/** Documented weights — urgency boosts availability + warranty so cheapest does not always win. */
export function scoreWeights(urgency: Urgency): ScoreBreakdown {
  if (urgency === 'high' || urgency === 'immediate') {
    return { price: 0.15, availability: 0.35, rating: 0.15, warranty: 0.2, fit: 0.15 };
  }
  if (urgency === 'low') {
    return { price: 0.35, availability: 0.15, rating: 0.2, warranty: 0.15, fit: 0.15 };
  }
  return { price: 0.28, availability: 0.22, rating: 0.2, warranty: 0.15, fit: 0.15 };
}

function priceAnchor(offer: NormalizedOfferContract): number | null {
  if (offer.visit_fee != null) return offer.visit_fee;
  if (offer.estimated_total_min != null) return offer.estimated_total_min;
  return null;
}

function parseStartHour(arrival: string): number | null {
  const match = arrival.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\b/);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

export function scoreAvailability(
  arrival: string | null,
  preferredWindows: string[],
  urgency: Urgency,
): { score: number; unknown: boolean } {
  if (!arrival) return { score: 0.5, unknown: true };
  const hour = parseStartHour(arrival);
  if (hour == null) return { score: 0.55, unknown: false };

  let score = urgency === 'high' || urgency === 'immediate'
    ? Math.max(0, Math.min(1, (22 - hour) / 22))
    : Math.max(0.35, Math.min(1, 1 - Math.abs(hour - 18) / 18));

  const prefs = preferredWindows.map((entry) => entry.toLowerCase());
  if (prefs.some((entry) => entry.includes('evening') || entry.includes('tonight')) && hour >= 17 && hour <= 21) {
    score = Math.min(1, score + 0.15);
  }
  if (prefs.some((entry) => entry.includes('morning')) && hour >= 7 && hour <= 12) {
    score = Math.min(1, score + 0.15);
  }
  return { score, unknown: false };
}

export function scoreWarranty(days: number | null, maxKnown: number): { score: number; unknown: boolean } {
  if (days == null) return { score: 0, unknown: true };
  const ceiling = Math.max(maxKnown, 7);
  return { score: Math.max(0, Math.min(1, days / ceiling)), unknown: false };
}

export function scoreRating(rating: number | null): { score: number; unknown: boolean } {
  if (rating == null) return { score: 0.5, unknown: true };
  return { score: Math.max(0, Math.min(1, rating / 5)), unknown: false };
}

export function scoreFit(
  offer: NormalizedOfferContract,
  provider: Row,
  requestCategory: string,
  preferredWindows: string[],
): number {
  const categories: string[] = Array.isArray(provider.categories) ? provider.categories.map(String) : [];
  let score = categories.some((entry) => entry.toLowerCase() === requestCategory.toLowerCase()) ? 0.75 : 0.4;
  if (String(provider.verification_status) === 'verified') score = Math.min(1, score + 0.1);
  if (preferredWindows.length && offer.arrival_window) score = Math.min(1, score + 0.05);
  return score;
}

export type RankCandidate = {
  offer: NormalizedOfferContract;
  provider: Row;
};

/**
 * Pure deterministic ranking. Paid placement is never a factor.
 * Excludes unnormalized drafts (extraction_confidence === 0).
 */
export function rankCandidates(
  candidates: RankCandidate[],
  urgency: Urgency,
  requestCategory: string,
  preferredWindows: string[],
): RankedOffer[] {
  const normalized = candidates.filter((item) => item.offer.extraction_confidence > 0);
  const anchors = normalized.map((item) => priceAnchor(item.offer)).filter((value): value is number => value != null);
  const minPrice = anchors.length ? Math.min(...anchors) : null;
  const maxPrice = anchors.length ? Math.max(...anchors) : null;
  const maxWarranty = Math.max(0, ...normalized.map((item) => item.offer.warranty_days ?? 0));
  const weights = scoreWeights(urgency);

  const ranked = normalized.map((item) => {
    const unknowns: string[] = [];
    const anchor = priceAnchor(item.offer);
    let price = 0.5;
    if (anchor == null) unknowns.push('price');
    else if (minPrice != null && maxPrice != null && maxPrice > minPrice) {
      price = 1 - (anchor - minPrice) / (maxPrice - minPrice);
    } else if (anchor != null) price = 1;

    const availability = scoreAvailability(item.offer.arrival_window, preferredWindows, urgency);
    if (availability.unknown) unknowns.push('availability');

    const rating = scoreRating(
      item.provider.rating === null || item.provider.rating === undefined
        ? null
        : Number(item.provider.rating),
    );
    if (rating.unknown) unknowns.push('rating');

    const warranty = scoreWarranty(item.offer.warranty_days, maxWarranty);
    if (warranty.unknown) unknowns.push('warranty');

    const fit = scoreFit(item.offer, item.provider, requestCategory, preferredWindows);
    const breakdown: ScoreBreakdown = {
      price,
      availability: availability.score,
      rating: rating.score,
      warranty: warranty.score,
      fit,
    };
    const total_score = Number(
      (
        breakdown.price * weights.price
        + breakdown.availability * weights.availability
        + breakdown.rating * weights.rating
        + breakdown.warranty * weights.warranty
        + breakdown.fit * weights.fit
      ).toFixed(6),
    );

    return {
      offer_id: item.offer.offer_id,
      provider_id: item.offer.provider_id,
      offer: item.offer,
      provider: {
        provider_id: String(item.provider.id),
        name: String(item.provider.name),
        rating: item.provider.rating === null || item.provider.rating === undefined
          ? null
          : Number(item.provider.rating),
        review_count: Number(item.provider.review_count ?? 0),
        verification_status: String(item.provider.verification_status),
        service_area: String(item.provider.service_area),
      },
      total_score,
      score_breakdown: breakdown,
      unknowns,
    } satisfies RankedOffer;
  });

  ranked.sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    const ratingA = a.provider.rating ?? -1;
    const ratingB = b.provider.rating ?? -1;
    if (ratingB !== ratingA) return ratingB - ratingA;
    if (b.provider.review_count !== a.provider.review_count) return b.provider.review_count - a.provider.review_count;
    const verified = (status: string) => (status === 'verified' ? 0 : 1);
    const verification = verified(a.provider.verification_status) - verified(b.provider.verification_status);
    if (verification !== 0) return verification;
    return a.offer_id.localeCompare(b.offer_id);
  });

  return ranked;
}

function cheapestOfferId(ranked: RankedOffer[]): string | null {
  let best: { id: string; price: number } | null = null;
  for (const item of ranked) {
    const price = priceAnchor(item.offer);
    if (price == null) continue;
    if (!best || price < best.price || (price === best.price && item.offer_id.localeCompare(best.id) < 0)) {
      best = { id: item.offer_id, price };
    }
  }
  return best?.id ?? null;
}

function templateExplanation(result: {
  recommended_offer_id: string | null;
  cheapest_offer_id: string | null;
  urgency: Urgency;
  ranked: RankedOffer[];
}): RankingExplanation {
  if (!result.recommended_offer_id || !result.ranked.length) {
    return {
      explanation: 'No schema-valid normalized offers are available to rank yet.',
      cited_factors: [],
      why_not_cheapest: null,
      confidence: 0.05,
    };
  }
  const winner = result.ranked[0]!;
  const factors = (Object.entries(winner.score_breakdown) as [keyof ScoreBreakdown, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  let why_not_cheapest: string | null = null;
  if (result.cheapest_offer_id && result.cheapest_offer_id !== result.recommended_offer_id) {
    why_not_cheapest =
      `Offer ${result.cheapest_offer_id} has a lower price anchor, but ${result.recommended_offer_id} `
      + `scores higher on ${factors.filter((name) => name !== 'price').join(' and ') || 'non-price factors'} `
      + `under ${result.urgency} urgency.`;
  }
  return {
    explanation:
      `Recommended ${result.recommended_offer_id} using deterministic scores for price, availability, rating, warranty, and fit. `
      + `Top factors: ${factors.join(', ')}. Paid placement was not applied.`,
    cited_factors: factors,
    why_not_cheapest,
    confidence: 0.7,
  };
}

const EXPLAIN_INSTRUCTION =
  'Explain the precomputed offer ranking for the homeowner. '
  + 'You MUST treat recommended_offer_id and score_breakdown as authoritative — do not pick a different winner or invent prices, ratings, arrival times, or warranty. '
  + 'Cite only supplied factors. If the cheapest offer differs from the recommendation, explain why using availability, warranty, rating, or fit. '
  + 'Keep the explanation concise and transparent.';

export class Ranking {
  constructor(
    readonly db: Database,
    readonly ai = new AI(db),
  ) {}

  withTransport(transport: Transport) {
    return new Ranking(this.db, new AI(this.db, transport));
  }

  async run(userId: string, serviceRequestId: string): Promise<RankedOffersResult> {
    const requestRow = (await this.db.list('service_requests', { id: serviceRequestId, user_id: userId }))[0];
    if (!requestRow) throw new HttpError(404, 'Record not found');
    const contract = ServiceRequestContractSchema.parse({ ...requestRow.payload, status: requestRow.status });

    const offerRows = await this.db.list('offers', { service_request_id: serviceRequestId });
    const candidates: RankCandidate[] = [];
    for (const row of offerRows) {
      const parsed = NormalizedOfferContractSchema.safeParse({
        ...(row.payload as Record<string, unknown>),
        raw_response: row.raw_response ?? (row.payload as { raw_response?: string })?.raw_response,
      });
      if (!parsed.success) continue;
      const provider = (await this.db.list('providers', { id: parsed.data.provider_id }))[0];
      if (!provider) continue;
      candidates.push({ offer: parsed.data, provider });
    }

    const ranked = rankCandidates(
      candidates,
      contract.urgency,
      contract.category,
      contract.preferred_windows,
    );
    const recommended_offer_id = ranked[0]?.offer_id ?? null;
    const cheapest_offer_id = cheapestOfferId(ranked);
    const id = rankingId(serviceRequestId);

    if (!ranked.length) {
      const abstained = RankedOffersResultSchema.parse({
        service_request_id: serviceRequestId,
        ranking_id: id,
        ranked_offers: [],
        recommended_offer_id: null,
        explanation: 'No schema-valid normalized offers are available to rank yet.',
        recommendation_evidence: {
          recommended_offer_id: null,
          cheapest_offer_id: null,
          urgency: contract.urgency,
          cited_factors: [],
          why_not_cheapest: null,
          unknowns_noted: ['no_normalized_offers'],
          paid_placement_applied: false,
        },
        execution_state: 'abstained',
      });
      await this.persist(id, userId, serviceRequestId, null, abstained);
      await this.ai.record('B-05', {
        input_record_id: serviceRequestId,
        output_record_id: id,
        latency_ms: 0,
        confidence: 0.05,
        validation_passed: true,
        structured_output: { recommended_offer_id: null, ranked_count: 0 },
        structured_evidence: { schema_valid: true, unknowns: ['no_normalized_offers'] },
        safety_rule_hits: [],
        execution_state: 'abstained',
        error_code: null,
        fallback_reason: 'No schema-valid normalized offers available to rank',
      });
      return abstained;
    }

    const modelInput = {
      recommended_offer_id,
      cheapest_offer_id,
      urgency: contract.urgency,
      preferred_windows: contract.preferred_windows,
      ranked_offers: ranked.map((item) => ({
        offer_id: item.offer_id,
        provider_id: item.provider_id,
        total_score: item.total_score,
        score_breakdown: item.score_breakdown,
        unknowns: item.unknowns,
        visit_fee: item.offer.visit_fee,
        arrival_window: item.offer.arrival_window,
        warranty_days: item.offer.warranty_days,
        rating: item.provider.rating,
      })),
    };

    const fallback = templateExplanation({
      recommended_offer_id,
      cheapest_offer_id,
      urgency: contract.urgency,
      ranked,
    });
    const completed = await this.ai.complete(
      RankingExplanationSchema,
      EXPLAIN_INSTRUCTION,
      modelInput,
      fallback,
    );
    const narrative = completed.available ? completed.output : fallback;
    const execution_state = completed.available ? 'success' as const : 'fallback' as const;

    const result = RankedOffersResultSchema.parse({
      service_request_id: serviceRequestId,
      ranking_id: id,
      ranked_offers: ranked,
      recommended_offer_id,
      explanation: narrative.explanation,
      recommendation_evidence: {
        recommended_offer_id,
        cheapest_offer_id,
        urgency: contract.urgency,
        cited_factors: narrative.cited_factors,
        why_not_cheapest: narrative.why_not_cheapest,
        unknowns_noted: [...new Set(ranked.flatMap((item) => item.unknowns))].sort(),
        paid_placement_applied: false,
      },
      execution_state,
    });

    await this.persist(id, userId, serviceRequestId, recommended_offer_id, result);
    await this.ai.record('B-05', {
      input_record_id: serviceRequestId,
      output_record_id: id,
      latency_ms: completed.latencyMs,
      confidence: narrative.confidence,
      validation_passed: completed.available || execution_state === 'fallback',
      structured_output: {
        recommended_offer_id,
        ranked_count: ranked.length,
        cheapest_offer_id,
      },
      structured_evidence: {
        schema_valid: true,
        cited_factors: narrative.cited_factors,
        paid_placement_applied: false,
        deterministic_winner: true,
      },
      safety_rule_hits: [],
      execution_state,
      error_code: completed.available ? null : completed.errorCode,
      fallback_reason: completed.available ? null : 'Assessment unavailable; deterministic ranking retained with template explanation',
    });

    return result;
  }

  private async persist(
    id: string,
    userId: string,
    serviceRequestId: string,
    recommendedOfferId: string | null,
    payload: RankedOffersResult,
  ) {
    await this.db.save('offer_rankings', {
      id,
      service_request_id: serviceRequestId,
      user_id: userId,
      recommended_offer_id: recommendedOfferId,
      payload,
      created_at: new Date().toISOString(),
    });
  }
}
