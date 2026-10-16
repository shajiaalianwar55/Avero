import {
  BookingContractSchema,
  CreateDisputeInputSchema,
  DisputeContractSchema,
  PaymentContractSchema,
  ServiceRequestContractSchema,
  type BookingContract,
  type DisputeCategory,
  type DisputeContract,
  type FundsActionRecommendation,
  type PaymentContract,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';
import { paymentEventId, PROTECTION_LABEL, SANDBOX_DISCLOSURE } from './payment.js';

const DISPUTABLE_BOOKING = new Set([
  'confirmed',
  'provider_en_route',
  'in_progress',
  'awaiting_final_bill',
  'awaiting_customer_approval',
]);

/** Stable id so dispute retries return the same row per booking. */
export function disputeId(bookingId: string) {
  return `dsp_${bookingId}`;
}

export function fundsRecommendationFor(category: DisputeCategory): {
  funds_action_recommendation: FundsActionRecommendation;
  admin_needed: boolean;
} {
  if (category === 'no_show') {
    return { funds_action_recommendation: 'recommend_refund_review', admin_needed: true };
  }
  if (category === 'quality') {
    return { funds_action_recommendation: 'hold_protected_funds', admin_needed: true };
  }
  return { funds_action_recommendation: 'escalate_to_admin', admin_needed: true };
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

function toPayment(row: Row): PaymentContract {
  return PaymentContractSchema.parse(row.payload);
}

function toDispute(row: Row): DisputeContract {
  return DisputeContractSchema.parse(row.payload);
}

export class Dispute {
  constructor(readonly db: Database) {}

  async open(userId: string, bookingId: string, raw: unknown): Promise<DisputeContract> {
    const input = CreateDisputeInputSchema.parse(raw);

    const existing = (await this.db.list('disputes', { booking_id: bookingId, user_id: userId }))[0]
      ?? (await this.db.list('disputes', { booking_id: bookingId }))[0];
    if (existing) {
      const dispute = toDispute(existing);
      if (dispute.user_id !== userId) throw new HttpError(404, 'Record not found');
      return dispute;
    }

    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);

    if (booking.status === 'completed' || booking.status === 'cancelled') {
      throw new HttpError(409, 'Booking cannot be disputed in its current status');
    }
    if (booking.status === 'disputed') {
      throw new HttpError(409, 'Booking is already disputed');
    }
    if (!DISPUTABLE_BOOKING.has(booking.status)) {
      throw new HttpError(409, 'Booking cannot be disputed in its current status');
    }

    const paymentRow = (await this.db.list('payments', { booking_id: bookingId, user_id: userId }))[0];
    if (!paymentRow) throw new HttpError(409, 'Protected deposit payment is required');
    const payment = toPayment(paymentRow);
    if (payment.status === 'paid' || payment.status === 'payout_released') {
      throw new HttpError(409, 'Payment has already been settled or paid out');
    }
    if (payment.status !== 'protected' && payment.status !== 'disputed') {
      throw new HttpError(409, 'Only protected deposits can enter a dispute');
    }

    const now = new Date().toISOString();
    const recommendation = fundsRecommendationFor(input.category);
    const id = disputeId(booking.booking_id);
    const contract = DisputeContractSchema.parse({
      dispute_id: id,
      booking_id: booking.booking_id,
      payment_id: payment.payment_id,
      service_request_id: booking.service_request_id,
      user_id: booking.user_id,
      category: input.category,
      note: input.note.trim(),
      status: 'open',
      funds_action_recommendation: recommendation.funds_action_recommendation,
      admin_needed: recommendation.admin_needed,
      created_at: now,
      updated_at: now,
    });

    await this.db.save('disputes', {
      id: contract.dispute_id,
      booking_id: contract.booking_id,
      payment_id: contract.payment_id,
      user_id: contract.user_id,
      status: contract.status,
      category: contract.category,
      payload: contract,
      created_at: contract.created_at,
      updated_at: contract.updated_at,
    });

    await this.markBookingDisputed(bookingRow, booking, now);
    await this.markPaymentDisputed(paymentRow, payment, now, contract);
    await this.markRequestDisputed(booking);

    return contract;
  }

  async get(userId: string, id: string): Promise<DisputeContract> {
    const row = (await this.db.list('disputes', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    return toDispute(row);
  }

  private async markBookingDisputed(bookingRow: Row, booking: BookingContract, now: string) {
    const next = BookingContractSchema.parse({
      ...booking,
      status: 'disputed',
      updated_at: now,
    });
    await this.db.save('bookings', {
      ...bookingRow,
      status: next.status,
      payload: next,
      updated_at: next.updated_at,
    });
  }

  private async markPaymentDisputed(
    paymentRow: Row,
    payment: PaymentContract,
    now: string,
    dispute: DisputeContract,
  ) {
    const next = PaymentContractSchema.parse({
      ...payment,
      status: 'disputed',
      updated_at: now,
    });
    await this.db.save('payments', {
      ...paymentRow,
      status: next.status,
      payload: next,
      updated_at: next.updated_at,
    });

    await this.db.save('payment_events', {
      id: paymentEventId(next.payment_id, 'dispute_opened'),
      payment_id: next.payment_id,
      event_type: 'dispute_opened',
      payload: {
        event_type: 'dispute_opened',
        payment_id: next.payment_id,
        booking_id: dispute.booking_id,
        dispute_id: dispute.dispute_id,
        category: dispute.category,
        funds_action_recommendation: dispute.funds_action_recommendation,
        admin_needed: dispute.admin_needed,
        protection_label: PROTECTION_LABEL,
        sandbox: true,
        sandbox_disclosure: SANDBOX_DISCLOSURE,
        at: now,
      },
      created_at: now,
    });
  }

  private async markRequestDisputed(booking: BookingContract) {
    const requestRow = (await this.db.list('service_requests', {
      id: booking.service_request_id,
      user_id: booking.user_id,
    }))[0];
    if (!requestRow) return;
    const request = ServiceRequestContractSchema.parse(requestRow.payload);
    if (request.status === 'disputed' || request.status === 'completed') return;
    const next: ServiceRequestContract = ServiceRequestContractSchema.parse({
      ...request,
      status: 'disputed',
    });
    await this.db.save('service_requests', {
      ...requestRow,
      status: next.status,
      payload: next,
    });
  }
}
