import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BookingContractSchema,
  FinalBillContractSchema,
  NormalizedOfferContractSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking } from '../apps/provider/src/booking.js';
import { FinalBill, finalBillId, remainingBalance } from '../apps/provider/src/final-bill.js';
import { Payment, paymentId } from '../apps/provider/src/payment.js';
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

async function seedPaidBooking(db: ProviderMemoryDatabase) {
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
  const bookingRow = (await db.list('bookings', { id: booking.booking_id }))[0]!;
  return { contract, booking: BookingContractSchema.parse(bookingRow.payload) };
}

describe('B-08 final bill, approval, and payout', () => {
  it('computes remaining_balance as max(0, total - deposit)', () => {
    expect(remainingBalance(4500, 1500)).toBe(3000);
    expect(remainingBalance(1000, 1500)).toBe(0);
  });

  it('submits a final bill after protected deposit and is idempotent', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedPaidBooking(db);
    const bills = new FinalBill(db);

    const submitted = await bills.submit(contract.user_id, booking.booking_id, {
      lines: [
        { kind: 'labor', description: 'Visit and diagnose', amount: 1500 },
        { kind: 'parts', description: 'P-trap seal', amount: 3000 },
      ],
      notes: 'Parts required after inspection',
    });

    expect(FinalBillContractSchema.parse(submitted)).toMatchObject({
      final_bill_id: finalBillId(booking.booking_id),
      payment_id: paymentId(booking.booking_id),
      total_amount: 4500,
      amount_already_paid: 1500,
      remaining_balance: 3000,
      approval_status: 'pending',
      payment_status: 'protected',
      payout_state: 'not_ready',
    });

    const again = await bills.submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Different', amount: 1 }],
    });
    expect(again.final_bill_id).toBe(submitted.final_bill_id);
    expect(again.total_amount).toBe(4500);

    const bookingRow = (await db.list('bookings', { id: booking.booking_id }))[0]!;
    expect(bookingRow.status).toBe('awaiting_customer_approval');
  });

  it('approves and completes with sandbox settlement and payout release', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedPaidBooking(db);
    const bills = new FinalBill(db);

    await bills.submit(contract.user_id, booking.booking_id, {
      lines: [
        { kind: 'labor', description: 'Labor', amount: 2000 },
        { kind: 'parts', description: 'Parts', amount: 2500 },
      ],
    });

    const approved = await bills.approve(contract.user_id, booking.booking_id, {});
    expect(approved).toMatchObject({
      approval_status: 'approved',
      payment_status: 'paid',
      payout_state: 'pending_release',
      remaining_balance: 3000,
    });
    expect(approved.approved_at).toBeTruthy();

    const paymentRow = (await db.list('payments', { id: paymentId(booking.booking_id) }))[0]!;
    expect(paymentRow.status).toBe('paid');

    const settleEvents = (await db.list('payment_events', { payment_id: paymentId(booking.booking_id) }))
      .filter((row) => row.event_type === 'remaining_settled');
    expect(settleEvents).toHaveLength(1);

    const completed = await bills.complete(contract.user_id, booking.booking_id, {});
    expect(completed).toMatchObject({
      payment_status: 'payout_released',
      payout_state: 'released',
    });
    expect(completed.completed_at).toBeTruthy();

    const again = await bills.complete(contract.user_id, booking.booking_id, {});
    expect(again.payout_state).toBe('released');

    expect((await db.list('bookings', { id: booking.booking_id }))[0]?.status).toBe('completed');
    expect((await db.list('service_requests', { id: contract.request_id }))[0]?.status).toBe('completed');
    expect((await db.list('payments', { id: paymentId(booking.booking_id) }))[0]?.status).toBe('payout_released');
    expect(
      (await db.list('payment_events', { payment_id: paymentId(booking.booking_id) }))
        .some((row) => row.event_type === 'payout_released'),
    ).toBe(true);
  });

  it('rejects ownership misses and out-of-order completion', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedPaidBooking(db);
    const bills = new FinalBill(db);

    await expect(bills.submit('usr_other', booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Labor', amount: 1500 }],
    })).rejects.toMatchObject({ status: 404 });

    await expect(bills.approve(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 404 });

    await expect(bills.complete(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 404 });

    await bills.submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Labor', amount: 1500 }],
    });

    await expect(bills.complete(contract.user_id, booking.booking_id, {}))
      .rejects.toMatchObject({ status: 409 });

    const approved = await bills.approve(contract.user_id, booking.booking_id, {});
    expect(approved.remaining_balance).toBe(0);
    const again = await bills.approve(contract.user_id, booking.booking_id, {});
    expect(again.approval_status).toBe('approved');
  });

  it('rejects final bill before deposit is protected', async () => {
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

    await expect(new FinalBill(db).submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Labor', amount: 1500 }],
    })).rejects.toMatchObject({ status: 409 });
  });
});
