import {
  BookingContractSchema,
  ConfirmPaymentInputSchema,
  PaymentContractSchema,
  PaymentIntentInputSchema,
  ServiceRequestContractSchema,
  type BookingContract,
  type PaymentContract,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';

export const PROTECTION_LABEL = 'Payment protected by Avero' as const;
export const SANDBOX_DISCLOSURE = 'Sandbox payment — not legal escrow' as const;

/** Stable id so payment-intent retries upsert the same deposit row. */
export function paymentId(bookingId: string) {
  return `pay_${bookingId}`;
}

export function paymentEventId(paymentIdValue: string, eventType: string) {
  return `pevt_${paymentIdValue}_${eventType}`;
}

export function receiptReference(paymentIdValue: string) {
  return `rcpt_${paymentIdValue}`;
}

function toPayment(row: Row): PaymentContract {
  return PaymentContractSchema.parse(row.payload);
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

export class Payment {
  constructor(readonly db: Database) {}

  async intent(userId: string, bookingId: string, raw: unknown): Promise<PaymentContract> {
    const input = PaymentIntentInputSchema.parse(raw ?? {});
    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);

    const existing = (await this.db.list('payments', { booking_id: bookingId }))[0];
    if (existing) {
      const payment = toPayment(existing);
      if (payment.status === 'protected') return payment;
      if (booking.status === 'pending_payment') return payment;
      throw new HttpError(409, 'Booking cannot accept payment in its current status');
    }

    if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'disputed') {
      throw new HttpError(409, 'Booking cannot accept payment in its current status');
    }
    if (booking.status !== 'pending_payment') {
      throw new HttpError(409, 'Booking is not awaiting payment');
    }

    const depositAmount = input.amount ?? booking.price_basis.amount;
    if (depositAmount == null) {
      throw new HttpError(400, 'Deposit amount is required when the booking has no price basis');
    }

    const now = new Date().toISOString();
    const id = paymentId(booking.booking_id);
    const contract = PaymentContractSchema.parse({
      payment_id: id,
      booking_id: booking.booking_id,
      service_request_id: booking.service_request_id,
      user_id: booking.user_id,
      deposit_amount: depositAmount,
      currency: booking.price_basis.currency,
      status: 'authorized',
      method: input.method,
      protection_status: 'intent',
      protection_label: PROTECTION_LABEL,
      sandbox: true,
      sandbox_disclosure: SANDBOX_DISCLOSURE,
      receipt_reference: null,
      created_at: now,
      updated_at: now,
    });

    await this.db.save('payments', {
      id: contract.payment_id,
      booking_id: contract.booking_id,
      user_id: contract.user_id,
      status: contract.status,
      amount: contract.deposit_amount,
      currency: contract.currency,
      payload: contract,
      created_at: contract.created_at,
      updated_at: contract.updated_at,
    });

    await this.db.save('payment_events', {
      id: paymentEventId(contract.payment_id, 'intent'),
      payment_id: contract.payment_id,
      event_type: 'intent_created',
      payload: {
        event_type: 'intent_created',
        payment_id: contract.payment_id,
        booking_id: contract.booking_id,
        deposit_amount: contract.deposit_amount,
        currency: contract.currency,
        protection_label: PROTECTION_LABEL,
        sandbox: true,
        at: now,
      },
      created_at: now,
    });

    return contract;
  }

  async confirm(userId: string, id: string, raw: unknown): Promise<PaymentContract> {
    ConfirmPaymentInputSchema.parse(raw ?? {});
    const row = (await this.db.list('payments', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');

    const current = toPayment(row);
    if (current.status === 'protected') return current;

    if (current.status !== 'authorized' && current.status !== 'pending') {
      throw new HttpError(409, 'Payment cannot be confirmed in its current status');
    }

    const bookingRow = (await this.db.list('bookings', {
      id: current.booking_id,
      user_id: userId,
    }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);
    if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'disputed') {
      throw new HttpError(409, 'Booking cannot accept payment in its current status');
    }

    const now = new Date().toISOString();
    const confirmed = PaymentContractSchema.parse({
      ...current,
      status: 'protected',
      protection_status: 'avero_protected',
      protection_label: PROTECTION_LABEL,
      sandbox: true,
      sandbox_disclosure: SANDBOX_DISCLOSURE,
      receipt_reference: receiptReference(current.payment_id),
      updated_at: now,
    });

    await this.db.save('payments', {
      ...row,
      status: confirmed.status,
      payload: confirmed,
      updated_at: confirmed.updated_at,
    });

    await this.db.save('payment_events', {
      id: paymentEventId(confirmed.payment_id, 'confirm'),
      payment_id: confirmed.payment_id,
      event_type: 'confirmed',
      payload: {
        event_type: 'confirmed',
        payment_id: confirmed.payment_id,
        booking_id: confirmed.booking_id,
        status: confirmed.status,
        protection_status: confirmed.protection_status,
        protection_label: PROTECTION_LABEL,
        receipt_reference: confirmed.receipt_reference,
        sandbox: true,
        at: now,
      },
      created_at: now,
    });

    await this.markBookingConfirmed(bookingRow, booking, now);
    return confirmed;
  }

  private async markBookingConfirmed(bookingRow: Row, booking: BookingContract, now: string) {
    const nextBooking = BookingContractSchema.parse({
      ...booking,
      status: 'confirmed',
      updated_at: now,
    });
    await this.db.save('bookings', {
      ...bookingRow,
      status: nextBooking.status,
      payload: nextBooking,
      updated_at: nextBooking.updated_at,
    });

    const requestRow = (await this.db.list('service_requests', {
      id: booking.service_request_id,
      user_id: booking.user_id,
    }))[0];
    if (!requestRow) return;

    const request = ServiceRequestContractSchema.parse(requestRow.payload);
    if (request.status === 'booked' || request.status === 'in_progress' || request.status === 'completed') {
      return;
    }
    const nextRequest = ServiceRequestContractSchema.parse({
      ...request,
      status: 'booked',
    });
    await this.db.save('service_requests', {
      ...requestRow,
      status: nextRequest.status,
      payload: nextRequest,
    });
  }
}
