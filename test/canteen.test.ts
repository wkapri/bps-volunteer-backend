import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
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

describe("buildCanteen", () => {
  it("returns empty canteen when no matching sign-up", async () => {
    const result = await buildCanteen(fakeClient([]), []);
    expect(result).toEqual({ signupId: null, title: null, signupUrl: "", days: [] });
  });

  it("aggregates shifts per day and computes status", async () => {
    // A weekday safely 14 days out, so it's always within the generated window
    // regardless of when the test runs (avoids "today" rollover edge cases).
    const targetDay = nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
    const startdate = Math.floor(targetDay.toSeconds());

    const rows: SugReportRow[] = [
      row({ item: "10-12", startdate, myqty: 1, firstname: "Jane", slotitemid: 100 }),
      row({ item: "10-12", startdate, myqty: 1, firstname: "", slotitemid: 100 }), // unfilled half of a 2-cap shift
      row({ item: "12-2", startdate, myqty: 2, firstname: "Joe", slotitemid: 101 }),
    ];

    const canteen = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
    const day = canteen.days.find((d) => d.date === targetDay.toISODate());

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
    expect(day.deepLink).toBe("https://www.signupgenius.com/go/canteen#/#100-date-wrap");
  });

  it("marks a weekday with zero capacity as closed", async () => {
    const targetDay = nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
    const laterDay = nextWeekday(targetDay.plus({ days: 1 }));
    const rows: SugReportRow[] = [
      row({ item: "10-12", startdate: Math.floor(laterDay.toSeconds()), myqty: 1, firstname: "Jane" }),
    ];

    const canteen = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
    const gapDay = canteen.days.find((d) => d.date === targetDay.toISODate());

    expect(gapDay).toEqual({ date: targetDay.toISODate(), weekday: targetDay.toFormat("cccc"), status: "closed" });
  });
});

function nextWeekday(dt: DateTime): DateTime {
  let d = dt.startOf("day");
  while (d.weekday >= 6) d = d.plus({ days: 1 });
  return d;
}
