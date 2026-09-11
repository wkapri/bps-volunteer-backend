import { DateTime } from "luxon";
import type { SignUpGeniusClient, SugCreatedSignup } from "./sugClient.js";
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

interface DayAgg {
  weekday: string;
  shifts: Map<string, { capacity: number; filled: number }>;
  /**
   * Best-effort per-day deep-link anchor. DESIGN.md section 10 flags this as
   * unverified: SignUpGenius's per-date `#<slotid>-date-wrap` anchor may only
   * be obtainable from the keyless public sheet endpoint, not this report
   * endpoint. Using the smallest slotitemid seen for the date as a stand-in
   * until confirmed against a real browser deep link — falls back to the
   * bare signupUrl if no slotitemid is present.
   */
  minSlotItemId: number | null;
}

export async function buildCanteen(
  client: SignUpGeniusClient,
  signups: SugCreatedSignup[],
): Promise<Canteen> {
  const canteenSignup = resolveCanteenSignup(signups);
  if (!canteenSignup) {
    return { signupId: null, title: null, signupUrl: "", days: [] };
  }

  const rows = await client.reportAll(canteenSignup.signupid);

  const byDate = new Map<string, DayAgg>();
  let lastDate: DateTime | null = null;

  for (const row of rows) {
    const dt = DateTime.fromSeconds(row.startdate, { zone: TIMEZONE });
    if (!dt.isValid) continue;
    if (dt.weekday >= 6) continue; // Sat/Sun rows shouldn't occur; guard anyway

    const dateKey = dt.toISODate();
    if (!dateKey) continue;
    if (!lastDate || dt > lastDate) lastDate = dt;

    let agg = byDate.get(dateKey);
    if (!agg) {
      agg = { weekday: dt.toFormat("cccc"), shifts: new Map(), minSlotItemId: null };
      byDate.set(dateKey, agg);
    }

    const qty = row.myqty || 0;
    const shift = agg.shifts.get(row.item) ?? { capacity: 0, filled: 0 };
    shift.capacity += qty;
    if (row.firstname) shift.filled += qty;
    agg.shifts.set(row.item, shift);

    if (typeof row.slotitemid === "number") {
      if (agg.minSlotItemId === null || row.slotitemid < agg.minSlotItemId) {
        agg.minSlotItemId = row.slotitemid;
      }
    }
  }

  const days: CanteenDay[] = [];

  if (lastDate) {
    const now = DateTime.now().setZone(TIMEZONE);
    const rolloverCutoff = now.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
    let cursor = now < rolloverCutoff ? now.startOf("day") : now.startOf("day").plus({ days: 1 });

    while (cursor <= lastDate) {
      if (cursor.weekday <= 5) {
        const dateKey = cursor.toISODate();
        if (dateKey) {
          days.push(buildDay(dateKey, cursor.toFormat("cccc"), byDate.get(dateKey), canteenSignup));
        }
      }
      cursor = cursor.plus({ days: 1 });
    }
  }

  return {
    signupId: canteenSignup.signupid,
    title: canteenSignup.title,
    signupUrl: canteenSignup.signupurl,
    days,
  };
}

function buildDay(
  date: string,
  weekday: string,
  agg: DayAgg | undefined,
  canteenSignup: SugCreatedSignup,
): CanteenDay {
  if (!agg) {
    return { date, weekday, status: "closed" };
  }

  const shifts: CanteenShift[] = [...agg.shifts.entries()].map(([label, s]) => ({
    label,
    capacity: s.capacity,
    filled: s.filled,
  }));
  const capacity = shifts.reduce((sum, s) => sum + s.capacity, 0);
  const filled = shifts.reduce((sum, s) => sum + s.filled, 0);

  const pct = fillPct(filled, capacity);
  if (pct === null) {
    return { date, weekday, status: "closed" };
  }

  const status = statusFromPct(pct) as "green" | "amber" | "red";
  const deepLink =
    agg.minSlotItemId != null
      ? `${canteenSignup.signupurl}#/#${agg.minSlotItemId}-date-wrap`
      : canteenSignup.signupurl;

  return { date, weekday, status, capacity, filled, fillPct: pct, deepLink, shifts };
}
