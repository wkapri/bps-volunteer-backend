import { DateTime } from "luxon";
import type { CanteenShift } from "./types.js";

/**
 * Client for SignUpGenius's keyless, undocumented public sign-up sheet
 * endpoint — the same one the site's own Angular frontend calls to render a
 * signup page. Confirmed live 2026-09-11 by reverse-engineering
 * signup.min.js's `getsignup()` call site.
 *
 * This is DESIGN.md section 5's originally-specified *preferred* source for
 * canteen data (no key, no documented rate limit) — canteen.ts tries this
 * first and falls back to the key API's `/signups/report/all/` (capacity
 * inferred, no deep links) only if this endpoint is unreachable.
 *
 * It's also the *only* source for the per-date `slotid` the `-date-wrap`
 * deep-link anchor needs — report/all exposes a different, per-shift
 * `slotitemid` (nested one level deeper, under `items[]`, in this response's
 * shape) that does not work as the date anchor. DESIGN.md section 10 flagged
 * this as the open question; this resolves it.
 */

const ENDPOINT = "https://www.signupgenius.com/SUGboxAPI.cfm?go=s.getSignupInfo";

interface SugPublicSlotItem {
  item: string;
  slotitemid: number;
  // Observed live: a genuine number when non-zero, but "" (empty string) —
  // not 0 — when zero. Coerce with toCount(), never use these raw.
  qty: number | string; // total capacity for this shift on this date
  qtyTaken: number | string; // already-filled quantity — DESIGN.md 4.2/§10: sum of quantities, not participant count
}

/** `Number("")` is 0 in JS, which is what we want — but guard NaN from any other unexpected shape too. */
function toCount(value: number | string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

/**
 * Returns a map of ISO date -> { slotid, shifts (capacity/filled per item) },
 * built directly from SignUpGenius's own qty/qtyTaken — no inference needed.
 * Throws on a network/HTTP failure; callers should catch and fall back to
 * the key API.
 */
export async function fetchCanteenSlots(
  urlKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PublicDateSlot>> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forSignUpView: true, urlid: urlKey, portalid: "" }),
  });

  if (!res.ok) {
    throw new Error(`getSignupInfo failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as SugPublicSignupInfo;
  const slots = body.DATA?.slots ?? {};

  const map = new Map<string, PublicDateSlot>();
  for (const slot of Object.values(slots)) {
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
