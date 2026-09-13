import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NormalizedOfferContractSchema,
  RepairRecordContractSchema,
  ServiceRequestContractSchema,
  type NormalizedOfferContract,
} from '@avero/contracts';
import { Booking } from '../apps/provider/src/booking.js';
import { FinalBill } from '../apps/provider/src/final-bill.js';
import { Payment, paymentId } from '../apps/provider/src/payment.js';
import {
  RepairRecord,
  repairRecordId,
  warrantyEndFromOffer,
  workDoneFromBill,
} from '../apps/provider/src/repair-record.js';
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

async function seedThroughApprove(db: ProviderMemoryDatabase) {
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

  const bills = new FinalBill(db);
  await bills.submit(contract.user_id, booking.booking_id, {
    lines: [
      { kind: 'labor', description: 'Visit and diagnose', amount: 1500 },
      { kind: 'parts', description: 'P-trap seal', amount: 1700 },
    ],
    notes: 'P-trap connection reseated and seal replaced',
  });
  await bills.approve(contract.user_id, booking.booking_id, {});
  return { contract, booking, bills, selected };
}

describe('C-01 repair record generation', () => {
  it('creates exactly one repair record automatically on complete with mapped fields', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking, bills, selected } = await seedThroughApprove(db);

    expect(await db.list('repair_records')).toHaveLength(0);

    const completed = await bills.complete(contract.user_id, booking.booking_id, {});
    expect(completed.payout_state).toBe('released');

    const rows = await db.list('repair_records');
    expect(rows).toHaveLength(1);

    const record = RepairRecordContractSchema.parse(rows[0]!.payload);
    expect(record).toMatchObject({
      repair_record_id: repairRecordId(booking.booking_id),
      home_id: contract.home_id,
      asset_id: null,
      service_request_id: contract.request_id,
      booking_id: booking.booking_id,
      issue_summary: contract.issue_summary,
      diagnosis: contract.likely_issue,
      work_done: 'P-trap connection reseated and seal replaced',
      provider_name: 'Ahmed Plumbing Services',
      amount_paid: 3200,
      currency: 'PKR',
      warranty_end: warrantyEndFromOffer(record.completed_at, selected.warranty_days),
      notes: 'P-trap connection reseated and seal replaced',
    });
    expect(record.completed_at).toBeTruthy();
  });

  it('is idempotent on repeated complete and ensure', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking, bills } = await seedThroughApprove(db);

    await bills.complete(contract.user_id, booking.booking_id, {});
    await bills.complete(contract.user_id, booking.booking_id, {});
    await new RepairRecord(db).ensureForCompletedBooking(contract.user_id, booking.booking_id);

    expect(await db.list('repair_records')).toHaveLength(1);
    expect((await db.list('repair_records'))[0]?.id).toBe(repairRecordId(booking.booking_id));
  });

  it('does not create a repair record before completion', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking } = await seedThroughApprove(db);

    expect(await db.list('repair_records')).toHaveLength(0);
    await expect(new RepairRecord(db).ensureForCompletedBooking(contract.user_id, booking.booking_id))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.list('repair_records')).toHaveLength(0);
  });

  it('derives work_done from bill lines when notes are absent', async () => {
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
    const selected = offer({ offer_id: 'off_sr_001_pro_007', provider_id: 'pro_007', warranty_days: null });
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
    const payments = new Payment(db);
    await payments.intent(contract.user_id, booking.booking_id, {});
    await payments.confirm(contract.user_id, paymentId(booking.booking_id), {});
    const bills = new FinalBill(db);
    const submitted = await bills.submit(contract.user_id, booking.booking_id, {
      lines: [{ kind: 'labor', description: 'Reseated P-trap', amount: 1500 }],
    });
    expect(workDoneFromBill(submitted)).toBe('labor: Reseated P-trap');
    await bills.approve(contract.user_id, booking.booking_id, {});
    await bills.complete(contract.user_id, booking.booking_id, {});
    const record = RepairRecordContractSchema.parse((await db.list('repair_records'))[0]!.payload);
    expect(record.work_done).toBe('labor: Reseated P-trap');
    expect(record.warranty_end).toBeNull();
  });

  it('uses diagnosis session asset_id when present', async () => {
    const db = new ProviderMemoryDatabase();
    const { contract, booking, bills } = await seedThroughApprove(db);
    await db.save('diagnosis_sessions', {
      id: contract.diagnosis_session_id,
      user_id: contract.user_id,
      home_id: contract.home_id,
      payload: { complaint: 'leak', asset_id: 'asset_kitchen_sink' },
    });
    await bills.complete(contract.user_id, booking.booking_id, {});
    const record = RepairRecordContractSchema.parse((await db.list('repair_records'))[0]!.payload);
    expect(record.asset_id).toBe('asset_kitchen_sink');
  });
});
