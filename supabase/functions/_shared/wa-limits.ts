/**
 * Shared caps for WhatsApp interactive/list/button/template sends.
 *
 * These mirror Meta's own DOCUMENTED caps (3 quick-reply buttons, 10 list rows, 20/24-character
 * titles) as of the plan that added this file. This checkout has no way to verify them against
 * Meta's live API or documentation — there is no network access, no Meta developer account, and
 * no test send available from here. They are therefore enforced as REJECT thresholds, not
 * silent-truncation thresholds: a caller that violates one gets a thrown WaSendError at build
 * time, before anything reaches the wire, rather than a possibly-wrong value being quietly
 * clipped and sent anyway. If Meta's real limits differ from these, the failure mode of being
 * wrong-but-stricter is a loud build-time rejection, never a silent on-the-wire truncation.
 */

export const MAX_LIST_TITLE = 24; // characters in one list row title
export const MAX_LIST_SECTION = 24; // characters in a list section title
export const MAX_BUTTON_CTA = 20; // characters in a button label
export const MAX_BUTTONS = 3; // quick-reply buttons per interactive message
export const MAX_LIST_ROWS = 10; // total rows across all sections of one list

// MAX_REPLY_ID is THIS REPO'S OWN convention, not a figure sourced from Meta: three 24-character
// segments plus two ':' separators (24 + 1 + 24 + 1 + 24 = 74), deliberately far below any
// external reply-id length limit. See buildReplyId/parseReplyId in wa-send.ts.
export const MAX_REPLY_ID = 74;

/**
 * Returns `s` unchanged when it already fits within `max` characters. Otherwise returns a
 * shortened copy ending in a single ellipsis character, so the total length is exactly `max`.
 * When `max <= 1` there is no room for both content and an ellipsis, so this returns a plain
 * hard cut (`s.slice(0, max)`) instead.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}

/**
 * Splits `rows` into one page of at most `maxRows` entries, reporting whether anything was left
 * over.
 *
 * - `rows.length <= maxRows`: returns every row, `hasMore: false`.
 * - Otherwise, when `moreLabel` was supplied AND `maxRows > 1`: reserves one slot so the caller
 *   can append its own "show more" row — `page` has `maxRows - 1` entries.
 * - Otherwise (no `moreLabel`, or `maxRows <= 1` leaves no room to reserve a slot): caps hard at
 *   `maxRows` with no slot reserved.
 *
 * `page` is never empty when `rows` is non-empty and `maxRows >= 1`.
 */
export function paginateRows<T>(
  rows: T[],
  maxRows: number,
  moreLabel?: string
): { page: T[]; hasMore: boolean } {
  if (rows.length <= maxRows) {
    return { page: rows, hasMore: false };
  }
  const canReserve = typeof moreLabel === 'string' && moreLabel.length > 0 && maxRows > 1;
  const pageSize = canReserve ? maxRows - 1 : maxRows;
  return { page: rows.slice(0, pageSize), hasMore: true };
}
