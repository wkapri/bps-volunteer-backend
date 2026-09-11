import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanteen } from "../src/canteen.js";
import type { SignUpGeniusClient, SugCreatedSignup, SugReportRow } from "../src/sugClient.js";

const CANTEEN_SIGNUP: SugCreatedSignup = {
  signupid: 63670841,
  title: "Canteen Volunteer Term 4 2026",
  group: "Beecroft Public School - Canteen",
  groupid: 1,
  signupurl: "https://www.signupgenius.com/go/canteen",
  contactname: "William Kwok",
  startdate: 0,
  enddate: 0,
  startdatestring: "",
  enddatestring: "",
  starttime: 0,
  endtime: 0,
  thumbnail: "",
  mainimage: "",
};

function row(overrides: Partial<SugReportRow>): SugReportRow {
  return {
    itemmemberid: "",
    item: "10-12",
    signupid: "63670841",
    slotitemid: "",
    startdate: 0,
    startdatestring: "",
    myqty: 1,
    firstname: "",
    lastname: "",
    email: "",
    status: "",
    waitlist: 0,
    ...overrides,
  };
}

function fakeClient(rows: SugReportRow[]): SignUpGeniusClient {
  return { reportAll: async () => rows } as unknown as SignUpGeniusClient;
}

/** Stubs global fetch to answer the public getSignupInfo call with one date-slot. */
function stubDateSlotIdFetch(dateSlotIds: Array<{ date: DateTime; slotid: number }>) {
  const slots: Record<string, unknown> = {};
  for (const { date, slotid } of dateSlotIds) {
    slots[String(slotid)] = { slotid, starttime: `${date.toFormat("LLLL, d yyyy")} 00:00:00` };
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ MESSAGE: [], DATA: { slots } }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCanteen", () => {
  it("returns empty canteen when no matching sign-up", async () => {
    const result = await buildCanteen(fakeClient([]), []);
    expect(result).toEqual({
      canteen: { signupId: null, title: null, signupUrl: "", days: [] },
      warnings: [],
    });
  });

  it("aggregates shifts per day, computes status, and builds the deep link from the public slotid", async () => {
    // A weekday safely 14 days out, so it's always within the generated window
    // regardless of when the test runs (avoids "today" rollover edge cases).
    const targetDay = nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
    const startdate = Math.floor(targetDay.toSeconds());
    stubDateSlotIdFetch([{ date: targetDay, slotid: 837061137 }]);

    const rows: SugReportRow[] = [
      row({ item: "10-12", startdate, myqty: 1, firstname: "Jane", slotitemid: 1843217753 }),
      row({ item: "10-12", startdate, myqty: 1, firstname: "" }), // unfilled half of a 2-cap shift
      row({ item: "12-2", startdate, myqty: 2, firstname: "Joe", slotitemid: 1843217752 }),
    ];

    const { canteen, warnings } = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
    const day = canteen.days.find((d) => d.date === targetDay.toISODate());

    expect(warnings).toEqual([]);
    expect(day).toBeDefined();
    if (!day || day.status === "closed") throw new Error("expected an open day");

    expect(day.capacity).toBe(4); // 1 + 1 + 2
    expect(day.filled).toBe(3); // 1 (Jane) + 2 (Joe)
    expect(day.fillPct).toBe(75);
    expect(day.status).toBe("green");
    expect(day.shifts).toEqual(
      expect.arrayContaining([
        { label: "10-12", capacity: 2, filled: 1 },
        { label: "12-2", capacity: 2, filled: 2 },
      ]),
    );
    // The date-level slotid (837061137), NOT the per-shift slotitemid (1843217753/52) —
    // that's the bug this test guards against regressing to.
    expect(day.deepLink).toBe("https://www.signupgenius.com/go/canteen#/#837061137-date-wrap");
  });

  it("falls back to the bare signupUrl and warns when the public endpoint fails", async () => {
    const targetDay = nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
    const startdate = Math.floor(targetDay.toSeconds());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    const rows: SugReportRow[] = [row({ item: "10-12", startdate, myqty: 1, firstname: "Jane" })];
    const { canteen, warnings } = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
    const day = canteen.days.find((d) => d.date === targetDay.toISODate());

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/canteen deep links/);
    if (!day || day.status === "closed") throw new Error("expected an open day");
    expect(day.deepLink).toBe("https://www.signupgenius.com/go/canteen");
  });

  it("marks a weekday with zero capacity as closed", async () => {
    const targetDay = nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
    const laterDay = nextWeekday(targetDay.plus({ days: 1 }));
    stubDateSlotIdFetch([{ date: laterDay, slotid: 837061137 }]);
    const rows: SugReportRow[] = [
      row({ item: "10-12", startdate: Math.floor(laterDay.toSeconds()), myqty: 1, firstname: "Jane" }),
    ];

    const { canteen } = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
    const gapDay = canteen.days.find((d) => d.date === targetDay.toISODate());

    expect(gapDay).toEqual({ date: targetDay.toISODate(), weekday: targetDay.toFormat("cccc"), status: "closed" });
  });
});

function nextWeekday(dt: DateTime): DateTime {
  let d = dt.startOf("day");
  while (d.weekday >= 6) d = d.plus({ days: 1 });
  return d;
}
