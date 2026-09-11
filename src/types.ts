/**
 * The `data.json` contract between this repo (producer) and `bps-volunteer-ui`
 * (consumer). Canonical description: DESIGN.md (in bps-volunteer-ui) section 4.
 *
 * This repo owns this schema. Keep bps-volunteer-ui's `src/data.ts` mirror
 * (and schema/data.schema.json in both repos) in sync with this file.
 */

export type Status = "green" | "amber" | "red" | "closed";

export interface CanteenShift {
  label: string;
  capacity: number;
  filled: number;
}

/** An open (or closed) canteen day. Closed days carry only date/weekday/status. */
export type CanteenDay =
  | {
      date: string; // ISO date, Sydney
      weekday: string;
      status: "green" | "amber" | "red";
      capacity: number;
      filled: number;
      fillPct: number;
      deepLink: string; // SignUpGenius, anchored to this date
      shifts: CanteenShift[];
      note?: string;
    }
  | {
      date: string;
      weekday: string;
      status: "closed";
      note?: string;
    };

export interface Canteen {
  signupId: number | null;
  title: string | null;
  signupUrl: string;
  days: CanteenDay[]; // empty => between terms
}

export interface VolunteerEvent {
  id: number;
  title: string;
  date: string; // ISO date, Sydney (v1: one event = one date)
  description: string | null;
  imageUrl: string | null;
  signupUrl: string;
  status: "green" | "amber" | "red";
  capacity: number;
  filled: number;
  fillPct: number;
  capacityNote?: string;
}

export interface Diagnostics {
  canteenSource?: "public-sheet" | "key-api";
  eventsFetched?: number;
  warnings?: string[];
}

export interface VolunteerData {
  generatedAt: string; // ISO 8601 with Sydney offset; last SUCCESSFUL build
  timezone: "Australia/Sydney";
  schemaVersion: 1;
  canteen: Canteen;
  events: VolunteerEvent[]; // sorted soonest-first
  diagnostics?: Diagnostics;
}
