import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NormalizedOfferContractSchema,
  PaymentContractSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking } from '../apps/provider/src/booking.js';
import {
  Payment,
  PROTECTION_LABEL,
  paymentId,
  receiptReference,
  SANDBOX_DISCLOSURE,
} from '../apps/provider/src/payment.js';
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
    raw_response: '1500 visit',
    extraction_confidence: 0.9,
    ...partial,
  });
}

async function seedBooking(db: ProviderMemoryDatabase, selected = offer({
  offer_id: 'off_sr_001_pro_007',
  provider_id: 'pro_007',
})) {
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
  return { contract, booking };
}

describe('B-07 sandbox payment protection', () => {
  it('creates a sandbox payment intent from the booking price basis', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedBooking(db);
    const payment = new Payment(db);

    const intent = await payment.intent(contract.user_id, booking.booking_id, {});
    expect(PaymentContractSchema.parse(intent)).toMatchObject({
      payment_id: paymentId(booking.booking_id),
      booking_id: booking.booking_id,
      deposit_amount: 1500,
      currency: 'PKR',
      status: 'authorized',
      method: 'sandbox_card',
      protection_status: 'intent',
      protection_label: PROTECTION_LABEL,
      sandbox: true,
      sandbox_disclosure: SANDBOX_DISCLOSURE,
      receipt_reference: null,
    });

    const events = await db.list('payment_events', { payment_id: intent.payment_id });
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('intent_created');
  });

  it('is idempotent on payment-intent and confirm, and advances booking + service request', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedBooking(db);
    const payment = new Payment(db);

    const first = await payment.intent(contract.user_id, booking.booking_id, { method: 'sandbox_card' });
    const second = await payment.intent(contract.user_id, booking.booking_id, {});
    expect(second.payment_id).toBe(first.payment_id);
    expect(await db.list('payments')).toHaveLength(1);

    const confirmed = await payment.confirm(contract.user_id, first.payment_id, {});
    expect(confirmed).toMatchObject({
      status: 'protected',
      protection_status: 'avero_protected',
      protection_label: PROTECTION_LABEL,
      receipt_reference: receiptReference(first.payment_id),
      sandbox: true,
    });

    const again = await payment.confirm(contract.user_id, first.payment_id, { sandbox_result: 'succeeded' });
    expect(again.status).toBe('protected');
    expect(again.receipt_reference).toBe(confirmed.receipt_reference);

    const bookingRow = (await db.list('bookings', { id: booking.booking_id }))[0]!;
    expect(bookingRow.status).toBe('confirmed');
    expect(bookingRow.payload.status).toBe('confirmed');

    const requestRow = (await db.list('service_requests', { id: contract.request_id }))[0]!;
    expect(requestRow.status).toBe('booked');
    expect(requestRow.payload.status).toBe('booked');

    const events = await db.list('payment_events', { payment_id: first.payment_id });
    expect(events.map((row) => row.event_type).sort()).toEqual(['confirmed', 'intent_created']);
  });

  it('rejects ownership misses, missing deposit, cancelled confirm, and cancelled intent', async () => {
    const db = new ProviderMemoryDatabase();
    const noPrice = offer({
      offer_id: 'off_sr_001_pro_007',
      provider_id: 'pro_007',
      visit_fee: null,
      estimated_total_min: null,
    });
    const { contract, booking } = await seedBooking(db, noPrice);
    const payment = new Payment(db);

    await expect(payment.intent('usr_other', booking.booking_id, { amount: 1000 }))
      .rejects.toMatchObject({ status: 404 });

    await expect(payment.intent(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 400 });

    const intent = await payment.intent(contract.user_id, booking.booking_id, { amount: 1200 });
    expect(intent.deposit_amount).toBe(1200);

    await expect(payment.confirm('usr_other', intent.payment_id, {}))
      .rejects.toMatchObject({ status: 404 });

    await new Booking(db).cancel(contract.user_id, booking.booking_id);
    await expect(payment.confirm(contract.user_id, intent.payment_id, {}))
      .rejects.toMatchObject({ status: 409 });
    await expect(payment.intent(contract.user_id, booking.booking_id, { amount: 1200 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects intent on a cancelled booking with no prior payment', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedBooking(db);
    await new Booking(db).cancel(contract.user_id, booking.booking_id);
    await expect(new Payment(db).intent(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 409 });
  });
});
