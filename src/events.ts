import { DateTime } from "luxon";
import type { SignUpGeniusClient, SugCreatedSignup } from "./sugClient.js";
import { fillPct, statusFromPct } from "./status.js";
import type { VolunteerEvent } from "./types.js";

const TIMEZONE = "Australia/Sydney";

export interface BuildEventsResult {
  events: VolunteerEvent[];
  warnings: string[];
  fetchedCount: number;
  failureCount: number;
}

/**
 * DESIGN.md section 4.3: skip a failed event, record a warning, keep going.
 * After 3 failures in a run, the run should notify William (email dispatch
 * is not implemented yet — see README) but still publish what succeeded.
 */
export async function buildEvents(
  client: SignUpGeniusClient,
  signups: SugCreatedSignup[],
  canteenSignupId: number | null,
): Promise<BuildEventsResult> {
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  const candidates = signups.filter((s) => s.signupid !== canteenSignupId);

  const events: VolunteerEvent[] = [];
  const warnings: string[] = [];
  let failureCount = 0;

  for (const s of candidates) {
    const eventDate = DateTime.fromSeconds(s.startdate, { zone: TIMEZONE });
    if (eventDate.isValid && eventDate.startOf("day") < today) {
      continue; // dropped: past Sydney midnight after the event date
    }

    try {
      const rows = await client.reportAll(s.signupid);
      let capacity = 0;
      let filled = 0;
      for (const row of rows) {
        const qty = row.myqty || 0;
        capacity += qty;
        if (row.firstname) filled += qty;
      }

      const pct = fillPct(filled, capacity);
      const status = (pct === null ? "red" : statusFromPct(pct)) as "green" | "amber" | "red";

      events.push({
        id: s.signupid,
        title: s.title,
        date: eventDate.isValid ? (eventDate.toISODate() ?? "") : "",
        description: null,
        imageUrl: s.mainimage || s.thumbnail || null,
        signupUrl: s.signupurl,
        status,
        capacity,
        filled,
        fillPct: pct ?? 0,
        capacityNote:
          "Naive sum of slot quantities — may include non-volunteer slots (see DESIGN.md section 10).",
      });
    } catch (err) {
      failureCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`event ${s.signupid} (${s.title}): ${message}`);
    }
  }

  if (failureCount > 3) {
    warnings.push(
      `${failureCount} events failed to fetch (>3) — should notify William per DESIGN.md section 4.3; email dispatch not yet implemented.`,
    );
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  return { events, warnings, fetchedCount: candidates.length, failureCount };
}
