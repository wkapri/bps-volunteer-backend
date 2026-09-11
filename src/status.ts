import type { Status } from "./types.js";

/** Status thresholds — DESIGN.md section 4.2. Same formula for canteen days and events. */
export function statusFromPct(pct: number | null): Status {
  if (pct === null) return "closed";
  if (pct < 25) return "red";
  if (pct < 75) return "amber";
  return "green";
}

/** null when capacity is 0 (closed / no slots), matching the data.json contract. */
export function fillPct(filled: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.round((100 * filled) / capacity);
}
