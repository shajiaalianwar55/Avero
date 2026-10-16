import {
  BookingContractSchema,
  CreateBookingInputSchema,
  NormalizedOfferContractSchema,
  ServiceRequestContractSchema,
  type BookingContract,
  type NormalizedOfferContract,
  type PriceBasis,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';

const TERMINAL_INACTIVE = new Set(['cancelled']);

/** Stable id so retries upsert the same booking for a request + offer pair. */
export function bookingId(serviceRequestId: string, offerId: string) {
  return `bk_${serviceRequestId}_${offerId}`;
}

export function priceBasisFromOffer(offer: NormalizedOfferContract): PriceBasis {
  if (offer.visit_fee != null) {
    return { amount: offer.visit_fee, currency: offer.currency, basis: 'visit_fee' };
  }
  if (offer.estimated_total_min != null) {
    return { amount: offer.estimated_total_min, currency: offer.currency, basis: 'estimated_total_min' };
  }
  return { amount: null, currency: offer.currency, basis: 'unspecified' };
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

function isActive(status: string) {
  return !TERMINAL_INACTIVE.has(status);
}

export class Booking {
  constructor(readonly db: Database) {}

  async create(userId: string, raw: unknown): Promise<BookingContract> {
    const input = CreateBookingInputSchema.parse(raw);

    const offerRows = await this.db.list('offers', { id: input.offer_id });
    const offerRow = offerRows[0];
    if (!offerRow) throw new HttpError(404, 'Record not found');

    const offer = NormalizedOfferContractSchema.parse(offerRow.payload);
    const requestRow = (await this.db.list('service_requests', {
      id: offer.service_request_id,
      user_id: userId,
    }))[0];
    if (!requestRow) throw new HttpError(404, 'Record not found');

    const request = ServiceRequestContractSchema.parse(requestRow.payload);
    const existing = await this.db.list('bookings', { service_request_id: request.request_id });
    const active = existing.find((row) => isActive(String(row.status)));
    if (active) {
      if (active.offer_id === input.offer_id) return toBooking(active);
      throw new HttpError(409, 'An active booking already exists for this service request');
    }

    const provider = (await this.db.list('providers', { id: offer.provider_id }))[0];
    if (!provider) throw new HttpError(404, 'Record not found');

    const now = new Date().toISOString();
    const id = bookingId(request.request_id, offer.offer_id);
    const contract = BookingContractSchema.parse({
      booking_id: id,
      service_request_id: request.request_id,
      offer_id: offer.offer_id,
      provider_id: offer.provider_id,
      provider_name: String(provider.name),
      user_id: request.user_id,
      home_id: request.home_id,
      status: 'pending_payment',
      appointment_window: input.appointment_window,
      price_basis: priceBasisFromOffer(offer),
      notes: input.notes?.trim() ? input.notes.trim() : null,
      created_at: now,
      updated_at: now,
      cancelled_at: null,
    });

    await this.db.save('bookings', {
      id: contract.booking_id,
      service_request_id: contract.service_request_id,
      offer_id: contract.offer_id,
      provider_id: contract.provider_id,
      user_id: contract.user_id,
      home_id: contract.home_id,
      status: contract.status,
      payload: contract,
      created_at: contract.created_at,
      updated_at: contract.updated_at,
    });

    await this.markRequestSelected(requestRow, request);

    return contract;
  }

  async get(userId: string, id: string): Promise<BookingContract> {
    const row = (await this.db.list('bookings', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    return toBooking(row);
  }

  async cancel(userId: string, id: string): Promise<BookingContract> {
    const row = (await this.db.list('bookings', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');

    const current = toBooking(row);
    if (current.status === 'cancelled') return current;
    if (current.status === 'completed' || current.status === 'disputed') {
      throw new HttpError(409, 'Booking cannot be cancelled in its current status');
    }

    const now = new Date().toISOString();
    const cancelled = BookingContractSchema.parse({
      ...current,
      status: 'cancelled',
      updated_at: now,
      cancelled_at: now,
    });

    await this.db.save('bookings', {
      ...row,
      status: cancelled.status,
      payload: cancelled,
      updated_at: cancelled.updated_at,
    });

    const requestRow = (await this.db.list('service_requests', {
      id: cancelled.service_request_id,
      user_id: userId,
    }))[0];
    if (requestRow) {
      const request = ServiceRequestContractSchema.parse(requestRow.payload);
      const next = ServiceRequestContractSchema.parse({
        ...request,
        status: 'offers_received',
      });
      await this.db.save('service_requests', {
        ...requestRow,
        status: next.status,
        payload: next,
      });
    }

    return cancelled;
  }

  private async markRequestSelected(requestRow: Row, request: ServiceRequestContract) {
    if (request.status === 'selected' || request.status === 'booked') return;
    const next = ServiceRequestContractSchema.parse({
      ...request,
      status: 'selected',
    });
    await this.db.save('service_requests', {
      ...requestRow,
      status: next.status,
      payload: next,
    });
  }
}
