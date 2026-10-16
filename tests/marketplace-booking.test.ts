import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BookingContractSchema,
  NormalizedOfferContractSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking, bookingId, priceBasisFromOffer } from '../apps/provider/src/booking.js';
import type { Row } from '../apps/provider/src/database.js';
import { ProviderMemoryDatabase } from './helpers/provider-memory.js';

const fixture = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'));

const provider: Row = {
  id: 'pro_007',
  name: 'Ahmed Plumbing Services',
  categories: ['plumbing'],
  service_area: 'Islamabad',
  rating: 4.8,
  review_count: 127,
  verification_status: 'verified',
};

function offer(partial: Partial<NormalizedOfferContract> & Pick<NormalizedOfferContract, 'offer_id' | 'provider_id'>): NormalizedOfferContract {
  return NormalizedOfferContractSchema.parse({
    service_request_id: 'sr_001',
    visit_fee: 1500,
    currency: 'PKR',
    estimated_total_min: 3000,
    estimated_total_max: 4500,
    parts_included: false,
    arrival_window: 'today 18:00-20:00',
    warranty_days: 7,
    raw_response: '1500 visit, 3000-4500 estimate, evening arrival, 7 day warranty',
    extraction_confidence: 0.9,
    ...partial,
  });
}

async function seed(db: ProviderMemoryDatabase, offers: NormalizedOfferContract[] = [offer({
  offer_id: 'off_sr_001_pro_007',
  provider_id: 'pro_007',
})]) {
  await db.save('providers', provider);
  await db.save('providers', {
    id: 'pro_008',
    name: 'Capital Home Repair',
    categories: ['plumbing', 'electrical'],
    service_area: 'Islamabad',
    rating: 4.6,
    review_count: 89,
    verification_status: 'verified',
  });

  const contract = ServiceRequestContractSchema.parse({
    ...fixture('fixtures/service-requests/valid.json') as object,
    status: 'offers_received',
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
    status: contract.status,
  });

  for (const entry of offers) {
    await db.save('offers', {
      id: entry.offer_id,
      service_request_id: entry.service_request_id,
      provider_id: entry.provider_id,
      payload: entry,
      raw_response: entry.raw_response,
    });
  }

  return contract;
}

describe('B-06 booking lifecycle', () => {
  it('creates a booking from a selected offer with price basis and pending_payment status', async () => {
    const db = new ProviderMemoryDatabase();
    const selected = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
    const request = await seed(db, [selected]);
    const booking = new Booking(db);

    const created = await booking.create(request.user_id, {
      offer_id: selected.offer_id,
      appointment_window: 'today_evening 18:00-20:00',
      notes: 'Please call on arrival',
    });

    expect(BookingContractSchema.parse(created)).toMatchObject({
      booking_id: bookingId('sr_001', selected.offer_id),
      service_request_id: 'sr_001',
      offer_id: selected.offer_id,
      provider_id: 'pro_007',
      provider_name: 'Ahmed Plumbing Services',
      status: 'pending_payment',
      appointment_window: 'today_evening 18:00-20:00',
      price_basis: { amount: 1500, currency: 'PKR', basis: 'visit_fee' },
      notes: 'Please call on arrival',
      cancelled_at: null,
    });

    const stored = await booking.get(request.user_id, created.booking_id);
    expect(stored.booking_id).toBe(created.booking_id);

    const requestRow = (await db.list('service_requests', { id: 'sr_001' }))[0]!;
    expect(requestRow.status).toBe('selected');
    expect(requestRow.payload.status).toBe('selected');
  });

  it('is idempotent for the same offer and blocks a second active booking for the request', async () => {
    const db = new ProviderMemoryDatabase();
    const first = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
    const second = offer({
      offer_id: 'off_sr_001_pro_008',
      provider_id: 'pro_008',
      visit_fee: 1200,
    });
    const request = await seed(db, [first, second]);
    const booking = new Booking(db);

    const created = await booking.create(request.user_id, {
      offer_id: first.offer_id,
      appointment_window: 'tomorrow morning',
    });
    const again = await booking.create(request.user_id, {
      offer_id: first.offer_id,
      appointment_window: 'tomorrow morning',
    });
    expect(again.booking_id).toBe(created.booking_id);
    expect((await db.list('bookings'))).toHaveLength(1);

    await expect(
      booking.create(request.user_id, {
        offer_id: second.offer_id,
        appointment_window: 'tomorrow evening',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cancels an active booking and allows a new selection afterward', async () => {
    const db = new ProviderMemoryDatabase();
    const first = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
    const second = offer({
      offer_id: 'off_sr_001_pro_008',
      provider_id: 'pro_008',
      visit_fee: null,
      estimated_total_min: 4000,
    });
    const request = await seed(db, [first, second]);
    const booking = new Booking(db);

    const created = await booking.create(request.user_id, {
      offer_id: first.offer_id,
      appointment_window: 'today_evening',
    });
    const cancelled = await booking.cancel(request.user_id, created.booking_id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_at).toBeTruthy();

    const requestRow = (await db.list('service_requests', { id: 'sr_001' }))[0]!;
    expect(requestRow.status).toBe('offers_received');

    const replacement = await booking.create(request.user_id, {
      offer_id: second.offer_id,
      appointment_window: 'tomorrow 10:00-12:00',
    });
    expect(replacement.booking_id).toBe(bookingId('sr_001', second.offer_id));
    expect(replacement.price_basis).toEqual({
      amount: 4000,
      currency: 'PKR',
      basis: 'estimated_total_min',
    });
    expect((await db.list('bookings'))).toHaveLength(2);
  });

  it('rejects cancel for completed bookings and hides other users bookings', async () => {
    const db = new ProviderMemoryDatabase();
    const selected = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
    const request = await seed(db, [selected]);
    const booking = new Booking(db);
    const created = await booking.create(request.user_id, {
      offer_id: selected.offer_id,
      appointment_window: 'today_evening',
    });

    const row = (await db.list('bookings', { id: created.booking_id }))[0]!;
    const completed = BookingContractSchema.parse({
      ...created,
      status: 'completed',
      updated_at: new Date().toISOString(),
    });
    await db.save('bookings', { ...row, status: 'completed', payload: completed });

    await expect(booking.cancel(request.user_id, created.booking_id)).rejects.toMatchObject({ status: 409 });
    await expect(booking.get('usr_other', created.booking_id)).rejects.toMatchObject({ status: 404 });
    await expect(booking.cancel('usr_other', created.booking_id)).rejects.toMatchObject({ status: 404 });
  });

  it('derives price basis preferring visit_fee then estimated_total_min', () => {
    expect(priceBasisFromOffer(offer({
      offer_id: 'off_a',
      provider_id: 'pro_007',
      visit_fee: 900,
      estimated_total_min: 2000,
    }))).toEqual({ amount: 900, currency: 'PKR', basis: 'visit_fee' });

    expect(priceBasisFromOffer(offer({
      offer_id: 'off_b',
      provider_id: 'pro_007',
      visit_fee: null,
      estimated_total_min: null,
    }))).toEqual({ amount: null, currency: 'PKR', basis: 'unspecified' });
  });
});
