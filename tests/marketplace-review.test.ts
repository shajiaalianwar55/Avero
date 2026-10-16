import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NormalizedOfferContractSchema,
  ReviewContractSchema,
  ServiceRequestContractSchema,
  WarrantyContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking } from '../apps/provider/src/booking.js';
import { FinalBill } from '../apps/provider/src/final-bill.js';
import { Payment, paymentId } from '../apps/provider/src/payment.js';
import { warrantyEndFromOffer } from '../apps/provider/src/repair-record.js';
import {
  Review,
  reviewId,
  warrantyId,
  warrantyStartFrom,
  warrantyTermsFrom,
} from '../apps/provider/src/review.js';
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
    raw_response: '1500 visit, 7 day warranty',
    extraction_confidence: 0.9,
    ...partial,
  });
}

async function seedCompletedBooking(
  db: ProviderMemoryDatabase,
  offerPartial: Partial<NormalizedOfferContract> = {},
) {
  await db.save('providers', provider);
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
  const selected = offer({
    offer_id: 'off_sr_001_pro_007',
    provider_id: 'pro_007',
    ...offerPartial,
  });
  await db.save('offers', {
    id: selected.offer_id,
    service_request_id: selected.service_request_id,
    provider_id: selected.provider_id,
    payload: selected,
    raw_response: selected.raw_response,
  });

  const booking = await new Booking(db).create(contract.user_id, {
    offer_id: selected.offer_id,
    appointment_window: 'today_evening 18:00-20:00',
  });
  const payments = new Payment(db);
  await payments.intent(contract.user_id, booking.booking_id, {});
  await payments.confirm(contract.user_id, paymentId(booking.booking_id), {});
  const bills = new FinalBill(db);
  await bills.submit(contract.user_id, booking.booking_id, {
    lines: [{ kind: 'labor', description: 'Visit and diagnose', amount: 1500 }],
    notes: 'P-trap reseated',
  });
  await bills.approve(contract.user_id, booking.booking_id, {});
  const completed = await bills.complete(contract.user_id, booking.booking_id, {});
  return { contract, booking, selected, completed };
}

describe('B-10 review and warranty capture', () => {
  it('stores rating/review and warranty dates from the accepted offer on completed bookings', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking, selected, completed } = await seedCompletedBooking(db);
    const reviews = new Review(db);

    const submitted = await reviews.submit(contract.user_id, booking.booking_id, {
      rating: 5,
      comment: 'Arrived on time and fixed the leak',
    });

    const expectedStart = warrantyStartFrom(completed.completed_at!);
    const expectedEnd = warrantyEndFromOffer(completed.completed_at!, selected.warranty_days);

    expect(ReviewContractSchema.parse(submitted)).toMatchObject({
      review_id: reviewId(booking.booking_id),
      booking_id: booking.booking_id,
      warranty_id: warrantyId(booking.booking_id),
      rating: 5,
      comment: 'Arrived on time and fixed the leak',
      warranty_start: expectedStart,
      warranty_end: expectedEnd,
      warranty_terms: warrantyTermsFrom(selected.warranty_days),
      provider_id: 'pro_007',
      home_id: contract.home_id,
    });

    expect(await db.list('reviews')).toHaveLength(1);
    expect(await db.list('warranties')).toHaveLength(1);
    const warranty = WarrantyContractSchema.parse((await db.list('warranties'))[0]!.payload);
    expect(warranty).toMatchObject({
      warranty_id: warrantyId(booking.booking_id),
      review_id: reviewId(booking.booking_id),
      warranty_start: expectedStart,
      warranty_end: expectedEnd,
      warranty_terms: warrantyTermsFrom(7),
      warranty_days: 7,
    });
  });

  it('is idempotent and supports GET review + warranty by owner', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedCompletedBooking(db);
    const reviews = new Review(db);

    const first = await reviews.submit(contract.user_id, booking.booking_id, {
      rating: 4,
      comment: 'Good work',
    });
    const second = await reviews.submit(contract.user_id, booking.booking_id, {
      rating: 1,
      comment: 'Ignored on retry',
    });
    expect(second).toEqual(first);
    expect(await db.list('reviews')).toHaveLength(1);
    expect(await db.list('warranties')).toHaveLength(1);

    expect(await reviews.get(contract.user_id, first.review_id)).toEqual(first);
    expect(await reviews.getWarranty(contract.user_id, first.warranty_id)).toMatchObject({
      warranty_id: first.warranty_id,
      review_id: first.review_id,
      warranty_start: first.warranty_start,
      warranty_end: first.warranty_end,
      warranty_terms: first.warranty_terms,
    });
  });

  it('rejects reviews before completion and hides foreign ownership', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedCompletedBooking(db);
    const reviews = new Review(db);

    await db.save('bookings', {
      ...(await db.list('bookings', { id: booking.booking_id }))[0]!,
      status: 'confirmed',
      payload: {
        ...(await db.list('bookings', { id: booking.booking_id }))[0]!.payload as object,
        status: 'confirmed',
      },
    });

    await expect(reviews.submit(contract.user_id, booking.booking_id, { rating: 5 }))
      .rejects.toMatchObject({ status: 409 });

    await expect(reviews.submit('usr_other', booking.booking_id, { rating: 5 }))
      .rejects.toMatchObject({ status: 404 });
    await expect(reviews.get('usr_other', reviewId(booking.booking_id)))
      .rejects.toMatchObject({ status: 404 });
    await expect(reviews.getWarranty('usr_other', warrantyId(booking.booking_id)))
      .rejects.toMatchObject({ status: 404 });
  });

  it('persists nullable warranty end when the offer has no warranty_days', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking, completed } = await seedCompletedBooking(db, { warranty_days: null });
    const reviews = new Review(db);

    const submitted = await reviews.submit(contract.user_id, booking.booking_id, { rating: 3 });
    expect(submitted.warranty_start).toBe(warrantyStartFrom(completed.completed_at!));
    expect(submitted.warranty_end).toBeNull();
    expect(submitted.warranty_terms).toBe(warrantyTermsFrom(null));
    expect((await reviews.getWarranty(contract.user_id, submitted.warranty_id)).warranty_days).toBeNull();
  });

  it('does not invent warranty beyond the offer and does not alter repair records', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedCompletedBooking(db);
    const before = await db.list('repair_records');
    expect(before).toHaveLength(1);

    await new Review(db).submit(contract.user_id, booking.booking_id, {
      rating: 5,
      comment: 'Solid fix',
    });

    expect(await db.list('repair_records')).toEqual(before);
  });
});
