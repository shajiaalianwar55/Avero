import {
  NormalizeOfferResultSchema,
  NormalizedOfferContractSchema,
  QuoteExtractionSchema,
  ServiceRequestContractSchema,
  type AIExecutionState,
  type NormalizeOfferResult,
  type QuoteExtraction,
} from '@avero/contracts';
import { HttpError, type Database } from './database.js';
import { AI, type Transport } from './ai.js';

const QUOTE_FIELDS = [
  'visit_fee',
  'estimated_total_min',
  'estimated_total_max',
  'parts_included',
  'arrival_window',
  'warranty_days',
] as const;

const INSTRUCTION =
  'Extract comparable quote fields from the provider raw_response. '
  + 'Use only explicitly stated information. Never invent visit fees, totals, parts inclusion, arrival windows, or warranty. '
  + 'Unknown values must be null. Prefer PKR when a Pakistani amount is clear (e.g. hazar = 1000). '
  + 'Normalize informal times when clear (e.g. shaam 7 baje → 19:00). '
  + 'Set abstain=true when the reply has no usable pricing or schedule details. '
  + 'List missing comparable fields in missing_fields and short human warnings in warnings '
  + '(e.g. "parts inclusion unknown", "insufficient pricing information").';

export function conservativeFallback(): QuoteExtraction {
  return {
    visit_fee: null,
    currency: 'PKR',
    estimated_total_min: null,
    estimated_total_max: null,
    parts_included: null,
    arrival_window: null,
    warranty_days: null,
    confidence: 0,
    missing_fields: [...QUOTE_FIELDS],
    warnings: ['insufficient pricing information'],
    abstain: true,
  };
}

/** Force unknowns when the model abstains or confidence is too low to trust money fields. */
export function applyConservativeExtraction(extraction: QuoteExtraction): QuoteExtraction {
  const warnings = [...extraction.warnings];
  const missing = new Set(extraction.missing_fields);
  let {
    visit_fee,
    estimated_total_min,
    estimated_total_max,
    parts_included,
    arrival_window,
    warranty_days,
    confidence,
    abstain,
    currency,
  } = extraction;

  const noMoney = visit_fee == null && estimated_total_min == null && estimated_total_max == null;
  if (abstain || (confidence <= 0.2 && noMoney)) {
    abstain = true;
    visit_fee = null;
    estimated_total_min = null;
    estimated_total_max = null;
    confidence = Math.min(confidence, 0.2);
    for (const field of ['visit_fee', 'estimated_total_min', 'estimated_total_max'] as const) missing.add(field);
    if (!warnings.includes('insufficient pricing information')) {
      warnings.push('insufficient pricing information');
    }
  }

  for (const field of QUOTE_FIELDS) {
    const value = {
      visit_fee,
      estimated_total_min,
      estimated_total_max,
      parts_included,
      arrival_window,
      warranty_days,
    }[field];
    if (value === null) missing.add(field);
    else missing.delete(field);
  }

  return QuoteExtractionSchema.parse({
    visit_fee,
    currency: (currency ?? 'PKR').toUpperCase(),
    estimated_total_min,
    estimated_total_max,
    parts_included,
    arrival_window,
    warranty_days,
    confidence,
    missing_fields: [...missing].sort(),
    warnings,
    abstain,
  });
}

function executionFor(
  available: boolean,
  extraction: QuoteExtraction,
  errorCode: string | null,
): {
  execution_state: AIExecutionState;
  validation_passed: boolean;
  error_code: string | null;
  fallback_reason: string | null;
} {
  if (!available) {
    return {
      execution_state: 'fallback',
      validation_passed: false,
      error_code: errorCode,
      fallback_reason: 'Assessment unavailable; conservative fallback used',
    };
  }
  if (extraction.abstain) {
    return {
      execution_state: 'abstained',
      validation_passed: true,
      error_code: null,
      fallback_reason: 'Insufficient information to extract comparable quote fields',
    };
  }
  return {
    execution_state: 'success',
    validation_passed: true,
    error_code: null,
    fallback_reason: null,
  };
}

export class Normalize {
  constructor(
    readonly db: Database,
    readonly ai = new AI(db),
  ) {}

  /** Test helper: inject a fake transport without touching customer code. */
  withTransport(transport: Transport) {
    return new Normalize(this.db, new AI(this.db, transport));
  }

  async run(userId: string, offerId: string): Promise<NormalizeOfferResult> {
    const offerRow = (await this.db.list('offers', { id: offerId }))[0];
    if (!offerRow) throw new HttpError(404, 'Record not found');

    const requestRow = (await this.db.list('service_requests', {
      id: String(offerRow.service_request_id),
      user_id: userId,
    }))[0];
    if (!requestRow) throw new HttpError(404, 'Record not found');

    const contract = ServiceRequestContractSchema.parse({ ...requestRow.payload, status: requestRow.status });
    const raw_response = String(offerRow.raw_response ?? '').trim();
    if (!raw_response) throw new HttpError(400, 'Offer is missing raw_response');

    const responseRows = await this.db.list('provider_responses', {
      service_request_id: String(offerRow.service_request_id),
      provider_id: String(offerRow.provider_id),
    });
    const inputRecordId = String(responseRows[0]?.id ?? offerId);

    const draftHints = (offerRow.payload ?? {}) as Record<string, unknown>;
    const modelInput = {
      raw_response,
      // Draft form fields are hints only; raw_response is authoritative for extraction.
      draft_fields: {
        visit_fee: draftHints.visit_fee ?? null,
        estimated_total_min: draftHints.estimated_total_min ?? null,
        estimated_total_max: draftHints.estimated_total_max ?? null,
        parts_included: draftHints.parts_included ?? null,
        arrival_window: draftHints.arrival_window ?? null,
        warranty_days: draftHints.warranty_days ?? null,
        currency: draftHints.currency ?? 'PKR',
      },
      // A-09 contract as context only — no reshaping.
      service_request: {
        request_id: contract.request_id,
        category: contract.category,
        issue_summary: contract.issue_summary,
        urgency: contract.urgency,
        location: contract.location,
      },
    };

    const completed = await this.ai.complete(
      QuoteExtractionSchema,
      INSTRUCTION,
      modelInput,
      conservativeFallback(),
    );
    const extraction = applyConservativeExtraction(completed.available ? completed.output : conservativeFallback());
    const exec = executionFor(completed.available, extraction, completed.errorCode);

    const offer = NormalizedOfferContractSchema.parse({
      offer_id: String(offerRow.id),
      service_request_id: String(offerRow.service_request_id),
      provider_id: String(offerRow.provider_id),
      visit_fee: extraction.visit_fee,
      currency: extraction.currency ?? 'PKR',
      estimated_total_min: extraction.estimated_total_min,
      estimated_total_max: extraction.estimated_total_max,
      parts_included: extraction.parts_included,
      arrival_window: extraction.arrival_window,
      warranty_days: extraction.warranty_days,
      // Preserve original provider text from the offer row (B-03 seam).
      raw_response,
      extraction_confidence: extraction.confidence,
    });

    await this.db.save('offers', {
      ...offerRow,
      id: offer.offer_id,
      service_request_id: offer.service_request_id,
      provider_id: offer.provider_id,
      payload: offer,
      raw_response: offer.raw_response,
    });

    const parsedFields = QUOTE_FIELDS.filter((field) => offer[field] !== null);
    await this.ai.record('B-04', {
      input_record_id: inputRecordId,
      output_record_id: offer.offer_id,
      latency_ms: completed.latencyMs,
      confidence: extraction.confidence,
      validation_passed: exec.validation_passed,
      structured_output: {
        visit_fee: offer.visit_fee,
        currency: offer.currency,
        estimated_total_min: offer.estimated_total_min,
        estimated_total_max: offer.estimated_total_max,
        parts_included: offer.parts_included,
        arrival_window: offer.arrival_window,
        warranty_days: offer.warranty_days,
      },
      structured_evidence: {
        schema_valid: completed.available || exec.execution_state === 'fallback',
        parsed_fields: parsedFields,
        warnings: extraction.warnings,
        missing_fields: extraction.missing_fields,
      },
      safety_rule_hits: [],
      execution_state: exec.execution_state,
      error_code: exec.error_code,
      fallback_reason: exec.fallback_reason,
    });

    return NormalizeOfferResultSchema.parse({
      offer,
      missing_fields: extraction.missing_fields,
      normalization_warnings: extraction.warnings,
      execution_state: exec.execution_state,
    });
  }
}
