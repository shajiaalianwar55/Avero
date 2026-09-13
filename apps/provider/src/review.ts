import {
  BookingContractSchema,
  CreateReviewInputSchema,
  FinalBillContractSchema,
  NormalizedOfferContractSchema,
  ReviewContractSchema,
  WarrantyContractSchema,
  type BookingContract,
  type FinalBillContract,
  type ReviewContract,
  type WarrantyContract,
} from '@avero/contracts';
import { HttpError, type Database, type Row } from './database.js';
import { warrantyEndFromOffer } from './repair-record.js';

/** Stable id so review retries return the same row per booking. */
export function reviewId(bookingId: string) {
  return `rev_${bookingId}`;
}

/** Stable id so warranty retries return the same row per booking. */
export function warrantyId(bookingId: string) {
  return `war_${bookingId}`;
}

export function warrantyStartFrom(completedAt: string): string {
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(409, 'Completed booking is missing a valid completion timestamp');
  }
  return date.toISOString().slice(0, 10);
}

export function warrantyTermsFrom(warrantyDays: number | null | undefined): string {
  if (warrantyDays == null) return 'No warranty stated in the accepted offer';
  if (warrantyDays === 0) return 'No service warranty (0 days) stated in the accepted offer';
  return `${warrantyDays}-day service warranty as stated in the accepted offer`;
}

function toBooking(row: Row): BookingContract {
  return BookingContractSchema.parse(row.payload);
}

function toFinalBill(row: Row): FinalBillContract {
  return FinalBillContractSchema.parse(row.payload);
}

function toReview(row: Row): ReviewContract {
  return ReviewContractSchema.parse(row.payload);
}

function toWarranty(row: Row): WarrantyContract {
  return WarrantyContractSchema.parse(row.payload);
}

/**
 * B-10: capture rating/review on a completed booking and persist structured warranty
 * dates from the accepted offer for later history/reputation queries.
 */
export class Review {
  constructor(readonly db: Database) {}

  async submit(userId: string, bookingId: string, raw: unknown): Promise<ReviewContract> {
    const input = CreateReviewInputSchema.parse(raw);

    const existing = (await this.db.list('reviews', { booking_id: bookingId, user_id: userId }))[0]
      ?? (await this.db.list('reviews', { booking_id: bookingId }))[0];
    if (existing) {
      const review = toReview(existing);
      if (review.user_id !== userId) throw new HttpError(404, 'Record not found');
      return review;
    }

    const bookingRow = (await this.db.list('bookings', { id: bookingId, user_id: userId }))[0];
    if (!bookingRow) throw new HttpError(404, 'Record not found');
    const booking = toBooking(bookingRow);
    if (booking.status !== 'completed') {
      throw new HttpError(409, 'Only completed bookings can receive a review');
    }

    const billRow = (await this.db.list('final_bills', { booking_id: bookingId, user_id: userId }))[0];
    const completedAt = billRow
      ? (toFinalBill(billRow).completed_at ?? booking.updated_at)
      : booking.updated_at;

    const offerRow = (await this.db.list('offers', { id: booking.offer_id }))[0];
    const warrantyDays = offerRow
      ? NormalizedOfferContractSchema.parse(offerRow.payload).warranty_days
      : null;

    const now = new Date().toISOString();
    const warranty_start = warrantyStartFrom(completedAt);
    const warranty_end = warrantyEndFromOffer(completedAt, warrantyDays);
    const warranty_terms = warrantyTermsFrom(warrantyDays);
    const id = reviewId(booking.booking_id);
    const warId = warrantyId(booking.booking_id);
    const comment = input.comment?.trim() ? input.comment.trim() : null;

    const warranty = WarrantyContractSchema.parse({
      warranty_id: warId,
      review_id: id,
      booking_id: booking.booking_id,
      service_request_id: booking.service_request_id,
      user_id: booking.user_id,
      home_id: booking.home_id,
      provider_id: booking.provider_id,
      warranty_start,
      warranty_end,
      warranty_terms,
      warranty_days: warrantyDays ?? null,
      created_at: now,
      updated_at: now,
    });

    const review = ReviewContractSchema.parse({
      review_id: id,
      booking_id: booking.booking_id,
      service_request_id: booking.service_request_id,
      user_id: booking.user_id,
      home_id: booking.home_id,
      provider_id: booking.provider_id,
      provider_name: booking.provider_name,
      rating: input.rating,
      comment,
      warranty_id: warId,
      warranty_start,
      warranty_end,
      warranty_terms,
      created_at: now,
      updated_at: now,
    });

    await this.db.save('reviews', {
      id: review.review_id,
      booking_id: review.booking_id,
      user_id: review.user_id,
      provider_id: review.provider_id,
      rating: review.rating,
      payload: review,
      created_at: review.created_at,
      updated_at: review.updated_at,
    });

    await this.db.save('warranties', {
      id: warranty.warranty_id,
      booking_id: warranty.booking_id,
      review_id: warranty.review_id,
      home_id: warranty.home_id,
      user_id: warranty.user_id,
      provider_id: warranty.provider_id,
      warranty_start: warranty.warranty_start,
      warranty_end: warranty.warranty_end,
      payload: warranty,
      created_at: warranty.created_at,
      updated_at: warranty.updated_at,
    });

    return review;
  }

  async get(userId: string, id: string): Promise<ReviewContract> {
    const row = (await this.db.list('reviews', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    return toReview(row);
  }

  async getWarranty(userId: string, id: string): Promise<WarrantyContract> {
    const row = (await this.db.list('warranties', { id, user_id: userId }))[0];
    if (!row) throw new HttpError(404, 'Record not found');
    return toWarranty(row);
  }
}
