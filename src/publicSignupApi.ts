import { DateTime } from "luxon";

/**
 * Client for SignUpGenius's keyless, undocumented public sign-up sheet
 * endpoint — the same one the site's own Angular frontend calls to render a
 * signup page. Confirmed live 2026-09-11 by reverse-engineering
 * signup.min.js's `getsignup()` call site (see canteen.ts for why this is
 * needed: the per-date `-date-wrap` deep-link anchor uses a date-level
 * `slotid` that is NOT present anywhere in the key API's
 * `/signups/report/all/` response — that endpoint only exposes a *different*,
 * per-shift `slotitemid`, nested one level deeper under each date's `slotid`
 * in this response. DESIGN.md section 10 flagged this as the open question;
 * this resolves it.
 */

const ENDPOINT = "https://www.signupgenius.com/SUGboxAPI.cfm?go=s.getSignupInfo";

interface SugPublicSlotItem {
  item: string;
  slotitemid: number;
  qty: number;
  qtyTaken: number;
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

/** Extracts the `urlid` (everything after `/go/`) the public endpoint expects. */
export function urlKeyFromSignupUrl(signupUrl: string): string | null {
  const match = /\/go\/([^/?#]+)/.exec(signupUrl);
  return match ? match[1]! : null;
}

/**
 * Returns a map of ISO date -> per-date `slotid`, for building
 * `<signupUrl>#/#<slotid>-date-wrap` deep links. Returns an empty map (never
 * throws past a bad response shape) on any failure — callers should fall
 * back to the bare signupUrl and record a diagnostics warning.
 */
export async function fetchDateSlotIds(
  urlKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number>> {
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

  const map = new Map<string, number>();
  for (const slot of Object.values(slots)) {
    // starttime has no offset — it's already the calendar date SignUpGenius
    // means, so parse it literally rather than treating it as an instant.
    const dt = DateTime.fromFormat(slot.starttime, "LLLL, d yyyy HH:mm:ss");
    const dateKey = dt.isValid ? dt.toISODate() : null;
    if (dateKey) map.set(dateKey, slot.slotid);
  }
  return map;
}
