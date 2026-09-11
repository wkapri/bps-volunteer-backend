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

interface FakeItem {
  item: string;
  qty: number;
  qtyTaken: number;
  slotitemid?: number;
}

/** Stubs global fetch to answer the public getSignupInfo call. */
function stubPublicEndpoint(dateSlots: Array<{ date: DateTime; slotid: number; items: FakeItem[] }>) {
  const slots: Record<string, unknown> = {};
  for (const { date, slotid, items } of dateSlots) {
    slots[String(slotid)] = {
      slotid,
      starttime: `${date.toFormat("LLLL, d yyyy")} 00:00:00`,
      items: items.map((i) => ({ ...i, slotitemid: i.slotitemid ?? 0 })),
    };
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ MESSAGE: [], DATA: { slots } }),
    })),
  );
}

function stubPublicEndpointFailure(status = 500) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status, json: async () => ({}) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function nextWeekday(dt: DateTime): DateTime {
  let d = dt.startOf("day");
  while (d.weekday >= 6) d = d.plus({ days: 1 });
  return d;
}

// A weekday safely 14 days out, so it's always within the generated window
// regardless of when the test runs (avoids "today" rollover edge cases).
function farTargetDay(): DateTime {
  return nextWeekday(DateTime.now().setZone("Australia/Sydney").plus({ days: 14 }));
}

describe("buildCanteen", () => {
  it("returns empty canteen when no matching sign-up", async () => {
    const result = await buildCanteen(fakeClient([]), []);
    expect(result.canteen).toEqual({ signupId: null, title: null, signupUrl: "", days: [] });
    expect(result.warnings).toEqual([]);
  });

  describe("public sheet path (preferred)", () => {
    it("builds capacity/filled straight from qty/qtyTaken and the real per-date deep link", async () => {
      const targetDay = farTargetDay();
      stubPublicEndpoint([
        {
          date: targetDay,
          slotid: 837061137,
          items: [
            { item: "10-12", qty: 2, qtyTaken: 1, slotitemid: 1843217753 },
            { item: "12-2", qty: 2, qtyTaken: 2, slotitemid: 1843217752 },
          ],
        },
      ]);

      const { canteen, warnings, source } = await buildCanteen(fakeClient([]), [CANTEEN_SIGNUP]);
      const day = canteen.days.find((d) => d.date === targetDay.toISODate());

      expect(source).toBe("public-sheet");
      expect(warnings).toEqual([]);
      expect(day).toBeDefined();
      if (!day || day.status === "closed") throw new Error("expected an open day");

      expect(day.capacity).toBe(4);
      expect(day.filled).toBe(3);
      expect(day.fillPct).toBe(75);
      expect(day.status).toBe("green");
      expect(day.shifts).toEqual(
        expect.arrayContaining([
          { label: "10-12", capacity: 2, filled: 1 },
          { label: "12-2", capacity: 2, filled: 2 },
        ]),
      );
      // The date-level slotid (837061137), NOT a per-shift slotitemid — that
      // was the original bug this guards against regressing to.
      expect(day.deepLink).toBe("https://www.signupgenius.com/go/canteen#/#837061137-date-wrap");
    });

    it("marks a weekday with no matching date-slot as closed", async () => {
      const targetDay = farTargetDay();
      const laterDay = nextWeekday(targetDay.plus({ days: 1 }));
      stubPublicEndpoint([
        { date: laterDay, slotid: 837061138, items: [{ item: "10-12", qty: 1, qtyTaken: 0 }] },
      ]);

      const { canteen } = await buildCanteen(fakeClient([]), [CANTEEN_SIGNUP]);
      const gapDay = canteen.days.find((d) => d.date === targetDay.toISODate());

      expect(gapDay).toEqual({
        date: targetDay.toISODate(),
        weekday: targetDay.toFormat("cccc"),
        status: "closed",
      });
    });
  });

  describe("key API fallback", () => {
    it("falls back to report/all with the bare signupUrl when the public endpoint fails", async () => {
      stubPublicEndpointFailure();
      const targetDay = farTargetDay();
      const startdate = Math.floor(targetDay.toSeconds());
      const rows: SugReportRow[] = [
        row({ item: "10-12", startdate, myqty: 1, firstname: "Jane" }),
        row({ item: "10-12", startdate, myqty: 1, firstname: "" }),
        row({ item: "12-2", startdate, myqty: 2, firstname: "Joe" }),
      ];

      const { canteen, warnings, source } = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
      const day = canteen.days.find((d) => d.date === targetDay.toISODate());

      expect(source).toBe("key-api");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/canteen: public sheet endpoint failed/);
      if (!day || day.status === "closed") throw new Error("expected an open day");

      expect(day.capacity).toBe(4);
      expect(day.filled).toBe(3);
      expect(day.deepLink).toBe("https://www.signupgenius.com/go/canteen"); // bare signupUrl, no anchor
    });

    it("also falls back when the public endpoint returns zero date-slots", async () => {
      stubPublicEndpoint([]); // valid response, but nothing in it
      const targetDay = farTargetDay();
      const rows: SugReportRow[] = [
        row({ item: "10-12", startdate: Math.floor(targetDay.toSeconds()), myqty: 2, firstname: "Jane" }),
      ];

      const { canteen, source } = await buildCanteen(fakeClient(rows), [CANTEEN_SIGNUP]);
      expect(source).toBe("key-api");
      expect(canteen.days.some((d) => d.date === targetDay.toISODate())).toBe(true);
    });
  });
});
