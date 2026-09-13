import {
  BookingContractSchema,
  FinalBillContractSchema,
  NormalizedOfferContractSchema,
  RepairRecordContractSchema,
  ServiceRequestContractSchema,
  type BookingContract,
  type FinalBillContract,
  type RepairRecordContract,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';

/** Stable id so completion retries write the same repair record. */
export function repairRecordId(bookingId: string) {
  return `rr_${bookingId}`;
}

export function workDoneFromBill(bill: FinalBillContract): string {
  if (bill.notes?.trim()) return bill.notes.trim();
  const fromLines = bill.lines.map((line) => `${line.kind}: ${line.description}`).join('; ').trim();
  return fromLines || 'Work completed as billed';
}

export function warrantyEndFromOffer(completedAt: string, warrantyDays: number | null | undefined): string | null {
  if (warrantyDays == null || warrantyDays < 0) return null;
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + warrantyDays);
  return date.toISOString().slice(0, 10);
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

function toFinalBill(row: Row): FinalBillContract {
  return FinalBillContractSchema.parse(row.payload);
}

/**
 * C-01: build and persist one RepairRecordContract per completed booking.
 * Idempotent on rr_<booking_id>. Does not invent diagnosis text beyond SR / bill data.
 */
export class RepairRecord {
  constructor(readonly db: Database) {}

  async ensureForCompletedBooking(userId: string, bookingId: string): Promise<RepairRecordContract> {
    const existing = (await this.db.list('repair_records', { id: repairRecordId(bookingId) }))[0];
    if (existing) return RepairRecordContractSchema.parse(existing.payload);

    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);
    if (booking.status !== 'completed') {
      throw new HttpError(409, 'Booking must be completed before a repair record is created');
    }

    const billRow = (await this.db.list('final_bills', { booking_id: bookingId, user_id: userId }))[0];
    if (!billRow) throw new HttpError(409, 'Final bill is required to create a repair record');
    const bill = toFinalBill(billRow);
    if (bill.approval_status !== 'approved' || bill.payout_state !== 'released') {
      throw new HttpError(409, 'Final bill must be approved and payout released');
    }

    const requestRow = (await this.db.list('service_requests', {
      id: booking.service_request_id,
      user_id: userId,
    }))[0];
    if (!requestRow) throw new HttpError(404, 'Record not found');
    const request = ServiceRequestContractSchema.parse(requestRow.payload);

    const offerRow = (await this.db.list('offers', { id: booking.offer_id }))[0];
    const warrantyDays = offerRow
      ? NormalizedOfferContractSchema.parse(offerRow.payload).warranty_days
      : null;

    const completedAt = bill.completed_at ?? booking.updated_at;
    const assetId = await this.assetIdFromDiagnosis(userId, request);

    const contract = RepairRecordContractSchema.parse({
      repair_record_id: repairRecordId(booking.booking_id),
      home_id: booking.home_id,
      asset_id: assetId,
      service_request_id: booking.service_request_id,
      booking_id: booking.booking_id,
      issue_summary: request.issue_summary,
      diagnosis: request.likely_issue?.trim() || request.issue_summary,
      work_done: workDoneFromBill(bill),
      provider_name: booking.provider_name,
      amount_paid: bill.total_amount,
      currency: bill.currency,
      completed_at: completedAt,
      warranty_end: warrantyEndFromOffer(completedAt, warrantyDays),
      notes: bill.notes?.trim() ? bill.notes.trim() : null,
    });

    await this.db.save('repair_records', {
      id: contract.repair_record_id,
      home_id: contract.home_id,
      service_request_id: contract.service_request_id,
      payload: contract,
      completed_at: contract.completed_at,
    });

    return contract;
  }

  /** Cheap owned path: diagnosis session payload.asset_id when present. */
  private async assetIdFromDiagnosis(userId: string, request: ServiceRequestContract): Promise<string | null> {
    const session = (await this.db.list('diagnosis_sessions', {
      id: request.diagnosis_session_id,
      user_id: userId,
    }))[0];
    const assetId = session?.payload?.asset_id;
    return typeof assetId === 'string' && assetId.trim() ? assetId.trim() : null;
  }
}
