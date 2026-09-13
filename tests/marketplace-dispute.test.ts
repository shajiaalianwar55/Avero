import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DisputeContractSchema,
  NormalizedOfferContractSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking } from '../apps/provider/src/booking.js';
import { Dispute, disputeId, fundsRecommendationFor } from '../apps/provider/src/dispute.js';
import { FinalBill } from '../apps/provider/src/final-bill.js';
import { Payment, paymentId } from '../apps/provider/src/payment.js';
import { repairRecordId } from '../apps/provider/src/repair-record.js';
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

async function seedProtectedBooking(db: ProviderMemoryDatabase) {
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
  const selected = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
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
  return { contract, booking };
}

describe('B-09 disputes and cancellation protection', () => {
  it('opens a no_show dispute without completing or paying out', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedProtectedBooking(db);
    const disputes = new Dispute(db);

    const opened = await disputes.open(contract.user_id, booking.booking_id, {
      category: 'no_show',
      note: 'Technician did not arrive in the booked window',
    });

    expect(DisputeContractSchema.parse(opened)).toMatchObject({
      dispute_id: disputeId(booking.booking_id),
      booking_id: booking.booking_id,
      payment_id: paymentId(booking.booking_id),
      category: 'no_show',
      status: 'open',
      ...fundsRecommendationFor('no_show'),
    });

    expect((await db.list('bookings', { id: booking.booking_id }))[0]?.status).toBe('disputed');
    expect((await db.list('payments', { id: paymentId(booking.booking_id) }))[0]?.status).toBe('disputed');
    expect((await db.list('service_requests', { id: contract.request_id }))[0]?.status).toBe('disputed');
    expect(
      (await db.list('payment_events', { payment_id: paymentId(booking.booking_id) }))
        .some((row) => row.event_type === 'dispute_opened'),
    ).toBe(true);
    expect(await db.list('repair_records', { id: repairRecordId(booking.booking_id) })).toHaveLength(0);
    expect((await db.list('payments', { id: paymentId(booking.booking_id) }))[0]?.status).not.toBe('payout_released');
    expect((await db.list('payments', { id: paymentId(booking.booking_id) }))[0]?.status).not.toBe('paid');
  });

  it('is idempotent on open and supports GET by owner', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedProtectedBooking(db);
    const disputes = new Dispute(db);

    const first = await disputes.open(contract.user_id, booking.booking_id, {
      category: 'no_show',
      note: 'No-show',
    });
    const second = await disputes.open(contract.user_id, booking.booking_id, {
      category: 'quality',
      note: 'Different note ignored on retry',
    });
    expect(second.dispute_id).toBe(first.dispute_id);
    expect(second.category).toBe('no_show');
    expect(await db.list('disputes')).toHaveLength(1);

    const got = await disputes.get(contract.user_id, first.dispute_id);
    expect(got.dispute_id).toBe(first.dispute_id);
    await expect(disputes.get('usr_other', first.dispute_id)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects dispute after completion/payout', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedProtectedBooking(db);
    const bills = new FinalBill(db);
    await bills.submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Labor', amount: 1500 }],
    });
    await bills.approve(contract.user_id, booking.booking_id, {});
    await bills.complete(contract.user_id, booking.booking_id, {});

    await expect(new Dispute(db).open(contract.user_id, booking.booking_id, {
      category: 'no_show',
      note: 'Too late',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('blocks final bill and complete after a dispute is opened', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedProtectedBooking(db);
    await new Dispute(db).open(contract.user_id, booking.booking_id, {
      category: 'no_show',
      note: 'Technician did not arrive',
    });

    const bills = new FinalBill(db);
    await expect(bills.submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Labor', amount: 1500 }],
    })).rejects.toMatchObject({ status: 409 });

    await expect(bills.complete(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 404 });
  });

  it('rejects open from non-owners and before payment protection', async () => {
    const db = new ProviderMemoryDatabase();
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
    const selected = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007' });
    await db.save('offers', {
      id: selected.offer_id,
      service_request_id: selected.service_request_id,
      provider_id: selected.provider_id,
      payload: selected,
      raw_response: selected.raw_response,
    });
    const booking = await new Booking(db).create(contract.user_id, {
      offer_id: selected.offer_id,
      appointment_window: 'today_evening',
    });

    await expect(new Dispute(db).open('usr_other', booking.booking_id, {
      category: 'no_show',
      note: 'Nope',
    })).rejects.toMatchObject({ status: 404 });

    await expect(new Dispute(db).open(contract.user_id, booking.booking_id, {
      category: 'no_show',
      note: 'No deposit yet',
    })).rejects.toMatchObject({ status: 409 });
  });
});
