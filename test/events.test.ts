import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvents } from "../src/events.js";
import type { SignUpGeniusClient, SugCreatedSignup, SugReportRow } from "../src/sugClient.js";

function signup(overrides: Partial<SugCreatedSignup>): SugCreatedSignup {
  return {
    signupid: 1,
    title: "Some Event",
    group: "Beecroft Public School",
    groupid: 1,
    signupurl: "https://www.signupgenius.com/go/some-event",
    contactname: "William Kwok",
    startdate: 0,
    enddate: 0,
    startdatestring: "",
    enddatestring: "",
    starttime: 0,
    endtime: 0,
    thumbnail: "https://example.com/thumb.jpg",
    mainimage: "",
    ...overrides,
  };
}

function reportRow(overrides: Partial<SugReportRow>): SugReportRow {
  return {
    itemmemberid: "",
    item: "Helper",
    signupid: "1",
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

function fakeClient(rowsBySignupId: Record<number, SugReportRow[]>): SignUpGeniusClient {
  return {
    reportAll: async (signupId: number) => {
      const rows = rowsBySignupId[signupId];
      if (!rows) throw new Error(`no fake rows configured for signup ${signupId}`);
      return rows;
    },
  } as unknown as SignUpGeniusClient;
}

function stubPublicEndpoint(itemsBySlug: Record<string, Array<{ item: string; qty: number; qtyTaken: number }>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const { urlid } = JSON.parse(init.body) as { urlid: string };
      const items = itemsBySlug[urlid];
      if (!items) return { ok: true, json: async () => ({ MESSAGE: [], DATA: { slots: {} } }) };
      return {
        ok: true,
        json: async () => ({
          MESSAGE: [],
          DATA: { slots: { "1": { slotid: 1, starttime: "January, 1 2027 00:00:00", items } } },
        }),
      };
    }),
  );
}

function stubPublicEndpointFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Safely in the future so events aren't dropped by the Sydney-midnight rule.
const FUTURE = DateTime.now().setZone("Australia/Sydney").plus({ days: 30 });
const futureEpoch = () => Math.floor(FUTURE.toSeconds());

describe("buildEvents", () => {
  it("excludes the canteen sign-up from the candidate list", async () => {
    const signups = [signup({ signupid: 1, title: "Canteen Volunteer Term 4", startdate: futureEpoch() })];
    stubPublicEndpoint({});
    const { events, fetchedCount } = await buildEvents(fakeClient({}), signups, 1);
    expect(events).toEqual([]);
    expect(fetchedCount).toBe(0);
  });

  it("drops events whose date is before today (Sydney midnight rule)", async () => {
    const past = DateTime.now().setZone("Australia/Sydney").minus({ days: 5 });
    const signups = [signup({ signupid: 2, startdate: Math.floor(past.toSeconds()) })];
    const { events } = await buildEvents(fakeClient({}), signups, null);
    expect(events).toEqual([]);
  });

  it("uses the public endpoint's qty/qtyTaken when available (preferred source)", async () => {
    const signups = [
      signup({
        signupid: 3,
        title: "Trivia Night",
        signupurl: "https://www.signupgenius.com/go/trivia",
        startdate: futureEpoch(),
      }),
    ];
    stubPublicEndpoint({
      trivia: [
        { item: "Door", qty: 10, qtyTaken: 8 },
        { item: "Bar", qty: 10, qtyTaken: 2 },
      ],
    });

    const { events, failureCount, warnings } = await buildEvents(fakeClient({}), signups, null);

    expect(failureCount).toBe(0);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 3, title: "Trivia Night", capacity: 20, filled: 10, fillPct: 50, status: "amber" });
  });

  it("falls back to report/all when the public endpoint fails, without counting it as a failure", async () => {
    stubPublicEndpointFailure();
    const signups = [
      signup({ signupid: 4, title: "Working Bee", signupurl: "https://www.signupgenius.com/go/bee", startdate: futureEpoch() }),
    ];
    const rows: SugReportRow[] = [
      reportRow({ myqty: 5, firstname: "Jane" }),
      reportRow({ myqty: 3, firstname: "" }),
    ];

    const { events, failureCount, warnings } = await buildEvents(fakeClient({ 4: rows }), signups, null);

    expect(failureCount).toBe(0); // fallback succeeded — not a real failure
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ capacity: 8, filled: 5 });
  });

  it("coerces the key-API fallback's myqty the same way as the public endpoint (empty-string quirk)", async () => {
    stubPublicEndpointFailure();
    const signups = [signup({ signupid: 5, startdate: futureEpoch() })];
    const rows: SugReportRow[] = [
      reportRow({ myqty: "" as unknown as number, firstname: "" }),
      reportRow({ myqty: 2, firstname: "Jane" }),
    ];

    const { events } = await buildEvents(fakeClient({ 5: rows }), signups, null);
    expect(events[0]!.capacity).toBe(2);
    expect(events[0]!.filled).toBe(2);
    expect(typeof events[0]!.capacity).toBe("number");
  });

  it("counts a real failure only when both the public endpoint and the key API fail, and records a warning", async () => {
    stubPublicEndpointFailure();
    const signups = [signup({ signupid: 6, title: "Broken Event", startdate: futureEpoch() })];

    const { events, failureCount, warnings } = await buildEvents(fakeClient({}), signups, null); // no rows configured -> reportAll throws

    expect(events).toEqual([]);
    expect(failureCount).toBe(1);
    expect(warnings).toEqual([expect.stringMatching(/event 6 \(Broken Event\)/)]);
  });

  it("warns about notifying William once more than 3 events fail", async () => {
    stubPublicEndpointFailure();
    const signups = [7, 8, 9, 10].map((id) => signup({ signupid: id, startdate: futureEpoch() }));

    const { failureCount, warnings } = await buildEvents(fakeClient({}), signups, null);

    expect(failureCount).toBe(4);
    expect(warnings.some((w) => /notify William/.test(w))).toBe(true);
  });

  it("sorts events soonest-first by date", async () => {
    const day1 = FUTURE;
    const day2 = FUTURE.plus({ days: 10 });
    const signups = [
      signup({ signupid: 11, title: "Later", startdate: Math.floor(day2.toSeconds()), signupurl: "https://www.signupgenius.com/go/later" }),
      signup({ signupid: 12, title: "Sooner", startdate: Math.floor(day1.toSeconds()), signupurl: "https://www.signupgenius.com/go/sooner" }),
    ];
    stubPublicEndpoint({
      later: [{ item: "Helper", qty: 1, qtyTaken: 0 }],
      sooner: [{ item: "Helper", qty: 1, qtyTaken: 0 }],
    });

    const { events } = await buildEvents(fakeClient({}), signups, null);
    expect(events.map((e) => e.title)).toEqual(["Sooner", "Later"]);
  });
});
