import { DateTime } from "luxon";
import type { SignUpGeniusClient, SugCreatedSignup } from "./sugClient.js";
import { toCount } from "./numbers.js";
import { fetchCanteenSlots, urlKeyFromSignupUrl, type PublicDateSlot } from "./publicSignupApi.js";
import { fillPct, statusFromPct } from "./status.js";
import type { Canteen, CanteenDay, CanteenShift } from "./types.js";

const TIMEZONE = "Australia/Sydney";
const DEFAULT_TITLE_PREFIX = "Canteen Volunteer";

export function resolveCanteenSignup(signups: SugCreatedSignup[]): SugCreatedSignup | null {
  const idOverride = process.env.CANTEEN_SIGNUP_ID
    ? Number(process.env.CANTEEN_SIGNUP_ID)
    : undefined;
  if (idOverride) {
    return signups.find((s) => s.signupid === idOverride) ?? null;
  }
  const prefix = process.env.CANTEEN_TITLE_PREFIX ?? DEFAULT_TITLE_PREFIX;
  return signups.find((s) => s.title.startsWith(prefix)) ?? null;
}

export interface BuildCanteenResult {
  canteen: Canteen;
  warnings: string[];
  source: "public-sheet" | "key-api";
}

export async function buildCanteen(
  client: SignUpGeniusClient,
  signups: SugCreatedSignup[],
): Promise<BuildCanteenResult> {
  const canteenSignup = resolveCanteenSignup(signups);
  if (!canteenSignup) {
    return {
      canteen: { signupId: null, title: null, signupUrl: "", days: [] },
      warnings: [],
      source: "public-sheet",
    };
  }

  const warnings: string[] = [];
  const urlKey = urlKeyFromSignupUrl(canteenSignup.signupurl);

  if (urlKey) {
    try {
      const publicSlots = await fetchCanteenSlots(urlKey);
      if (publicSlots.size > 0) {
        return {
          canteen: buildFromPublicSlots(canteenSignup, publicSlots),
          warnings,
          source: "public-sheet",
        };
      }
      warnings.push("canteen: public sheet endpoint returned no date-slots; falling back to key API (no deep links)");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`canteen: public sheet endpoint failed (${message}); falling back to key API (no deep links)`);
    }
  } else {
    warnings.push(`canteen: could not parse urlid from signupUrl "${canteenSignup.signupurl}"; falling back to key API (no deep links)`);
  }

  return {
    canteen: await buildFromReportAll(client, canteenSignup),
    warnings,
    source: "key-api",
  };
}

/** Preferred path — DESIGN.md section 5: capacity/filled straight from SignUpGenius's own qty/qtyTaken, plus the real deep-link slotid. */
function buildFromPublicSlots(
  canteenSignup: SugCreatedSignup,
  publicSlots: Map<string, PublicDateSlot>,
): Canteen {
  const dates = [...publicSlots.keys()].map((d) => DateTime.fromISO(d, { zone: TIMEZONE }));
  const lastDate = dates.reduce((max, d) => (d > max ? d : max));

  const days = buildDayRange(lastDate, (dateKey, weekday) => {
    const slot = publicSlots.get(dateKey);
    if (!slot) return { date: dateKey, weekday, status: "closed" };

    const deepLink = `${canteenSignup.signupurl}#/#${slot.slotid}-date-wrap`;
    return summarizeDay(dateKey, weekday, slot.shifts, deepLink);
  });

  return { signupId: canteenSignup.signupid, title: canteenSignup.title, signupUrl: canteenSignup.signupurl, days };
}

/** Fallback path — key API only. Capacity/filled inferred from row presence; no deep links (DESIGN.md section 5). */
async function buildFromReportAll(
  client: SignUpGeniusClient,
  canteenSignup: SugCreatedSignup,
): Promise<Canteen> {
  const rows = await client.reportAll(canteenSignup.signupid);

  const byDate = new Map<string, Map<string, { capacity: number; filled: number }>>();
  let lastDate: DateTime | null = null;

  for (const row of rows) {
    const dt = DateTime.fromSeconds(row.startdate, { zone: TIMEZONE });
    if (!dt.isValid) continue;
    if (dt.weekday >= 6) continue; // Sat/Sun rows shouldn't occur; guard anyway

    const dateKey = dt.toISODate();
    if (!dateKey) continue;
    if (!lastDate || dt > lastDate) lastDate = dt;

    let shifts = byDate.get(dateKey);
    if (!shifts) {
      shifts = new Map();
      byDate.set(dateKey, shifts);
    }

    const qty = toCount(row.myqty);
    const shift = shifts.get(row.item) ?? { capacity: 0, filled: 0 };
    shift.capacity += qty;
    if (row.firstname) shift.filled += qty;
    shifts.set(row.item, shift);
  }

  const days = lastDate
    ? buildDayRange(lastDate, (dateKey, weekday) => {
        const shifts = byDate.get(dateKey);
        if (!shifts) return { date: dateKey, weekday, status: "closed" };
        const shiftList: CanteenShift[] = [...shifts.entries()].map(([label, s]) => ({ label, ...s }));
        return summarizeDay(dateKey, weekday, shiftList, canteenSignup.signupurl);
      })
    : [];

  return { signupId: canteenSignup.signupid, title: canteenSignup.title, signupUrl: canteenSignup.signupurl, days };
}

/** Weekdays only, from "today" (3pm Sydney rollover) through lastDate — DESIGN.md section 4.2. */
function buildDayRange(lastDate: DateTime, dayBuilder: (dateKey: string, weekday: string) => CanteenDay): CanteenDay[] {
  const now = DateTime.now().setZone(TIMEZONE);
  const rolloverCutoff = now.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  let cursor = now < rolloverCutoff ? now.startOf("day") : now.startOf("day").plus({ days: 1 });

  const days: CanteenDay[] = [];
  while (cursor <= lastDate) {
    if (cursor.weekday <= 5) {
      const dateKey = cursor.toISODate();
      if (dateKey) days.push(dayBuilder(dateKey, cursor.toFormat("cccc")));
    }
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/** capacity/filled/fillPct/status from a day's shifts. `deepLink` is the real per-date anchor (public path) or the bare signupUrl (key-API fallback). */
function summarizeDay(date: string, weekday: string, shifts: CanteenShift[], deepLink: string): CanteenDay {
  const capacity = shifts.reduce((sum, s) => sum + s.capacity, 0);
  const filled = shifts.reduce((sum, s) => sum + s.filled, 0);

  const pct = fillPct(filled, capacity);
  if (pct === null) return { date, weekday, status: "closed" };

  const status = statusFromPct(pct) as "green" | "amber" | "red";
  return { date, weekday, status, capacity, filled, fillPct: pct, deepLink, shifts };
}
