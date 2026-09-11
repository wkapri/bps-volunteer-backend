import { DateTime } from "luxon";
import { toCount } from "./numbers.js";
import type { CanteenShift } from "./types.js";

/**
 * Client for SignUpGenius's keyless, undocumented public sign-up sheet
 * endpoint — the same one the site's own Angular frontend calls to render a
 * signup page. Confirmed live 2026-09-11 by reverse-engineering
 * signup.min.js's `getsignup()` call site. Works identically for canteen and
 * one-off event sign-ups (events just have a single date-slot).
 *
 * This is DESIGN.md section 5's originally-specified *preferred* source for
 * both canteen and event data (no key, no documented rate limit) — canteen.ts
 * and events.ts try this first and fall back to the key API's
 * `/signups/report/all/` (capacity inferred, no deep links for canteen) only
 * if this endpoint is unreachable.
 *
 * It's also the *only* source for the per-date `slotid` the canteen
 * `-date-wrap` deep-link anchor needs — report/all exposes a different,
 * per-shift `slotitemid` (nested one level deeper, under `items[]`, in this
 * response's shape) that does not work as the date anchor. DESIGN.md section
 * 10 flagged this as the open question; this resolves it.
 */

const ENDPOINT = "https://www.signupgenius.com/SUGboxAPI.cfm?go=s.getSignupInfo";

interface SugPublicSlotItem {
  item: string;
  slotitemid: number;
  // Observed live: a genuine number when non-zero, but "" (empty string) —
  // not 0 — when zero. Always read through toCount(), never raw.
  qty: number | string; // total capacity for this shift on this date
  qtyTaken: number | string; // already-filled quantity — DESIGN.md 4.2/§10: sum of quantities, not participant count
}

interface SugPublicSlot {
  slotid: number;
  starttime: string; // e.g. "September, 17 2026 00:00:00" — no timezone; a plain calendar date
  items: SugPublicSlotItem[];
}

interface SugPublicSignupInfo {
  MESSAGE: string[];
  DATA?: {
    slots?: Record<string, SugPublicSlot>;
  };
}

export interface PublicDateSlot {
  slotid: number;
  shifts: CanteenShift[];
}

/** Extracts the `urlid` (everything after `/go/`) the public endpoint expects. */
export function urlKeyFromSignupUrl(signupUrl: string): string | null {
  const match = /\/go\/([^/?#]+)/.exec(signupUrl);
  return match ? match[1]! : null;
}

/** Shared fetch + parse. Throws on a network/HTTP failure; callers decide the fallback. */
async function fetchRawSlots(
  urlKey: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, SugPublicSlot>> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forSignUpView: true, urlid: urlKey, portalid: "" }),
  });

  if (!res.ok) {
    throw new Error(`getSignupInfo failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as SugPublicSignupInfo;
  return body.DATA?.slots ?? {};
}

/**
 * Returns a map of ISO date -> { slotid, shifts (capacity/filled per item)},
 * built directly from SignUpGenius's own qty/qtyTaken — no inference needed.
 * For canteen, which needs a full per-date breakdown (for the weekday walk
 * and per-date deep links). Throws on failure; caller falls back to the key
 * API.
 */
export async function fetchCanteenSlots(
  urlKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PublicDateSlot>> {
  const rawSlots = await fetchRawSlots(urlKey, fetchImpl);

  const map = new Map<string, PublicDateSlot>();
  for (const slot of Object.values(rawSlots)) {
    // starttime has no offset — it's already the calendar date SignUpGenius
    // means, so parse it literally rather than treating it as an instant.
    const dt = DateTime.fromFormat(slot.starttime, "LLLL, d yyyy HH:mm:ss");
    const dateKey = dt.isValid ? dt.toISODate() : null;
    if (!dateKey) continue;

    const shifts: CanteenShift[] = slot.items.map((item) => ({
      label: item.item,
      capacity: toCount(item.qty),
      filled: toCount(item.qtyTaken),
    }));
    map.set(dateKey, { slotid: slot.slotid, shifts });
  }
  return map;
}

/**
 * Returns the summed capacity/filled across every slot and item — for
 * one-off events, which (DESIGN.md section 4.2: "v1 assumes one event = one
 * date") just need a single event-level total, not a per-date breakdown.
 * Returns null (not an error) when the sign-up has no slots/items at all, so
 * callers can distinguish "legitimately empty" from "endpoint failed" (which
 * throws). Throws on a network/HTTP failure; caller falls back to the key API.
 */
export async function fetchSignupTotals(
  urlKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ capacity: number; filled: number } | null> {
  const rawSlots = await fetchRawSlots(urlKey, fetchImpl);
  const allItems = Object.values(rawSlots).flatMap((slot) => slot.items);
  if (allItems.length === 0) return null;

  let capacity = 0;
  let filled = 0;
  for (const item of allItems) {
    capacity += toCount(item.qty);
    filled += toCount(item.qtyTaken);
  }
  return { capacity, filled };
}
