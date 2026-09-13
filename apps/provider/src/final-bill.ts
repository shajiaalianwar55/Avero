import {
  BookingContractSchema,
  FinalBillContractSchema,
  PaymentContractSchema,
  ServiceRequestContractSchema,
  SubmitFinalBillInputSchema,
  type BookingContract,
  type FinalBillContract,
  type PaymentContract,
  type ServiceRequestContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';
import { paymentEventId, PROTECTION_LABEL, SANDBOX_DISCLOSURE } from './payment.js';

/** Stable id so final-bill retries upsert the same row per booking. */
export function finalBillId(bookingId: string) {
  return `fb_${bookingId}`;
}

export function remainingBalance(totalAmount: number, amountAlreadyPaid: number) {
  return Math.max(0, totalAmount - amountAlreadyPaid);
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

function toPayment(row: Row): PaymentContract {
  return PaymentContractSchema.parse(row.payload);
}

function toFinalBill(row: Row): FinalBillContract {
  return FinalBillContractSchema.parse(row.payload);
}

function sumLines(lines: { amount: number }[]) {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

export class FinalBill {
  constructor(readonly db: Database) {}

  async submit(userId: string, bookingId: string, raw: unknown): Promise<FinalBillContract> {
    const input = SubmitFinalBillInputSchema.parse(raw);
    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);

    const existing = (await this.db.list('final_bills', { booking_id: bookingId }))[0];
    if (existing) return toFinalBill(existing);

    if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'disputed') {
      throw new HttpError(409, 'Final bill cannot be submitted for this booking status');
    }
    if (booking.status !== 'confirmed' && booking.status !== 'in_progress' && booking.status !== 'awaiting_final_bill') {
      throw new HttpError(409, 'Booking is not ready for a final bill');
    }

    const paymentRow = (await this.db.list('payments', { booking_id: bookingId, user_id: userId }))[0];
    if (!paymentRow) throw new HttpError(409, 'Protected deposit payment is required');
    const payment = toPayment(paymentRow);
    if (payment.status !== 'protected' && payment.status !== 'paid' && payment.status !== 'payout_released') {
      throw new HttpError(409, 'Deposit payment must be protected before a final bill');
    }

    const totalAmount = sumLines(input.lines);
    const amountAlreadyPaid = payment.deposit_amount;
    const currency = (input.currency ?? payment.currency).toUpperCase();
    const now = new Date().toISOString();
    const id = finalBillId(booking.booking_id);

    const contract = FinalBillContractSchema.parse({
      final_bill_id: id,
      booking_id: booking.booking_id,
      service_request_id: booking.service_request_id,
      payment_id: payment.payment_id,
      user_id: booking.user_id,
      provider_id: booking.provider_id,
      lines: input.lines,
      total_amount: totalAmount,
      amount_already_paid: amountAlreadyPaid,
      remaining_balance: remainingBalance(totalAmount, amountAlreadyPaid),
      currency,
      approval_status: 'pending',
      payment_status: payment.status,
      payout_state: 'not_ready',
      notes: input.notes?.trim() ? input.notes.trim() : null,
      created_at: now,
      updated_at: now,
      approved_at: null,
      completed_at: null,
    });

    await this.db.save('final_bills', {
      id: contract.final_bill_id,
      booking_id: contract.booking_id,
      payment_id: contract.payment_id,
      user_id: contract.user_id,
      provider_id: contract.provider_id,
      status: 'submitted',
      payload: contract,
      created_at: contract.created_at,
      updated_at: contract.updated_at,
    });

    await this.updateBookingStatus(bookingRow, booking, 'awaiting_customer_approval', now);
    return contract;
  }

  async approve(userId: string, bookingId: string, raw: unknown): Promise<FinalBillContract> {
    // Empty / {} body allowed for sandbox approve.
    void raw;
    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);

    const billRow = (await this.db.list('final_bills', { booking_id: bookingId, user_id: userId }))[0];
    if (!billRow) throw new HttpError(404, 'Record not found');
    const bill = toFinalBill(billRow);
    if (bill.approval_status === 'approved') return bill;

    if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'disputed') {
      throw new HttpError(409, 'Final bill cannot be approved for this booking status');
    }

    const paymentRow = (await this.db.list('payments', { id: bill.payment_id, user_id: userId }))[0];
    if (!paymentRow) throw new HttpError(409, 'Protected deposit payment is required');
    const payment = toPayment(paymentRow);
    if (payment.status !== 'protected') {
      throw new HttpError(409, 'Deposit payment must be protected before approval');
    }

    const now = new Date().toISOString();
    const settledPayment = PaymentContractSchema.parse({
      ...payment,
      status: 'paid',
      updated_at: now,
    });
    await this.db.save('payments', {
      ...paymentRow,
      status: settledPayment.status,
      payload: settledPayment,
      updated_at: settledPayment.updated_at,
    });

    await this.db.save('payment_events', {
      id: paymentEventId(settledPayment.payment_id, 'settle_remaining'),
      payment_id: settledPayment.payment_id,
      event_type: 'remaining_settled',
      payload: {
        event_type: 'remaining_settled',
        payment_id: settledPayment.payment_id,
        booking_id: booking.booking_id,
        final_bill_id: bill.final_bill_id,
        amount_already_paid: bill.amount_already_paid,
        remaining_balance: bill.remaining_balance,
        total_amount: bill.total_amount,
        currency: bill.currency,
        protection_label: PROTECTION_LABEL,
        sandbox: true,
        sandbox_disclosure: SANDBOX_DISCLOSURE,
        at: now,
      },
      created_at: now,
    });

    const approved = FinalBillContractSchema.parse({
      ...bill,
      approval_status: 'approved',
      payment_status: 'paid',
      payout_state: 'pending_release',
      updated_at: now,
      approved_at: now,
    });
    await this.db.save('final_bills', {
      ...billRow,
      status: 'approved',
      payload: approved,
      updated_at: approved.updated_at,
    });

    return approved;
  }

  async complete(userId: string, bookingId: string, raw: unknown): Promise<FinalBillContract> {
    void raw;
    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);

    const billRow = (await this.db.list('final_bills', { booking_id: bookingId, user_id: userId }))[0];
    if (!billRow) throw new HttpError(404, 'Record not found');
    const bill = toFinalBill(billRow);
    if (bill.payout_state === 'released' && booking.status === 'completed') return bill;

    if (bill.approval_status !== 'approved') {
      throw new HttpError(409, 'Final bill must be approved before completion');
    }

    const paymentRow = (await this.db.list('payments', { id: bill.payment_id, user_id: userId }))[0];
    if (!paymentRow) throw new HttpError(409, 'Payment record is required');
    const payment = toPayment(paymentRow);
    if (payment.status !== 'paid' && payment.status !== 'payout_released') {
      throw new HttpError(409, 'Payment must be complete before the job can be completed');
    }

    const now = new Date().toISOString();
    const releasedPayment = PaymentContractSchema.parse({
      ...payment,
      status: 'payout_released',
      updated_at: now,
    });
    await this.db.save('payments', {
      ...paymentRow,
      status: releasedPayment.status,
      payload: releasedPayment,
      updated_at: releasedPayment.updated_at,
    });

    await this.db.save('payment_events', {
      id: paymentEventId(releasedPayment.payment_id, 'payout_released'),
      payment_id: releasedPayment.payment_id,
      event_type: 'payout_released',
      payload: {
        event_type: 'payout_released',
        payment_id: releasedPayment.payment_id,
        booking_id: booking.booking_id,
        final_bill_id: bill.final_bill_id,
        protection_label: PROTECTION_LABEL,
        sandbox: true,
        sandbox_disclosure: SANDBOX_DISCLOSURE,
        at: now,
      },
      created_at: now,
    });

    const completed = FinalBillContractSchema.parse({
      ...bill,
      payment_status: 'payout_released',
      payout_state: 'released',
      updated_at: now,
      completed_at: now,
    });
    await this.db.save('final_bills', {
      ...billRow,
      status: 'completed',
      payload: completed,
      updated_at: completed.updated_at,
    });

    await this.updateBookingStatus(bookingRow, booking, 'completed', now);
    await this.markRequestCompleted(booking, now);
    return completed;
  }

  private async updateBookingStatus(
    bookingRow: Row,
    booking: BookingContract,
    status: BookingContract['status'],
    now: string,
  ) {
    const next = BookingContractSchema.parse({
      ...booking,
      status,
      updated_at: now,
    });
    await this.db.save('bookings', {
      ...bookingRow,
      status: next.status,
      payload: next,
      updated_at: next.updated_at,
    });
  }

  private async markRequestCompleted(booking: BookingContract, _now: string) {
    const requestRow = (await this.db.list('service_requests', {
      id: booking.service_request_id,
      user_id: booking.user_id,
    }))[0];
    if (!requestRow) return;
    const request = ServiceRequestContractSchema.parse(requestRow.payload);
    if (request.status === 'completed') return;
    const next: ServiceRequestContract = ServiceRequestContractSchema.parse({
      ...request,
      status: 'completed',
    });
    await this.db.save('service_requests', {
      ...requestRow,
      status: next.status,
      payload: next,
    });
  }
}
